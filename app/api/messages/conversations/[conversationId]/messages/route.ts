import { notifyUser } from "@/lib/notify";
import { ensureAgencyOrgContext } from "@/lib/org/ensure-agency-context";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const MENTION_RE = /@([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await ensureAgencyOrgContext(user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  // Service-role ignores RLS; we must enforce membership explicitly.
  const { data: mem, error: memErr } = await ctx.admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr) {
    console.error("[messages GET] membership check", memErr);
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }
  if (!mem) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  const { data: messages, error } = await ctx.admin
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    console.error("[messages GET] messages query", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: messages ?? [] });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const { conversationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { body, reply_to_id } = await request.json() as {
    body: string;
    reply_to_id?: string | null;
  };

  if (!body?.trim()) {
    return NextResponse.json({ error: "body required" }, { status: 400 });
  }

  const ctx = await ensureAgencyOrgContext(user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const orgId = ctx.orgId;
  // Service-role ignores RLS; enforce membership explicitly.
  const { data: mem, error: memErr } = await ctx.admin
    .from("conversation_members")
    .select("conversation_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr) {
    console.error("[messages POST] membership check", memErr);
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }
  if (!mem) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  const { data: msg, error } = await ctx.admin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      author_id: user.id,
      body: body.trim(),
      reply_to_id: reply_to_id || null,
    })
    .select()
    .single();

  if (error || !msg) {
    return NextResponse.json(
      { error: error?.message || "Failed" },
      { status: 500 }
    );
  }

  await ctx.admin
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  const mentions = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, "gi");
  while ((m = re.exec(body)) !== null) {
    mentions.add(m[1]);
  }
  for (const uid of mentions) {
    if (uid === user.id) continue;
    try {
      await notifyUser({
        orgId,
        userId: uid,
        type: "mention",
        title: "Mention dans la messagerie",
        body: body.slice(0, 120),
        payload: { conversationId, messageId: msg.id },
      });
    } catch (e) {
      // Don't block message creation if notifications fail.
      console.error("[messages POST] notifyUser failed", e);
    }
  }

  return NextResponse.json({ message: msg });
}
