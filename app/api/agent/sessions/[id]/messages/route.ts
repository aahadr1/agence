import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { userMessageLikelyResetsScope } from "@/lib/agent/active-intent";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import {
  isSmallTalkOnly,
  smallTalkAssistantReply,
} from "@/lib/agent/intent-classifier";
import { scheduleNextTick } from "@/lib/agent/runtime/schedule";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as { content: string };
  const content = body.content?.trim() || "";
  if (!content)
    return NextResponse.json({ error: "content required" }, { status: 400 });

  const service = await createServiceClient();
  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const { data: session } = await service
    .from("agent_sessions")
    .select("id, status, org_id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error: insErr } = await service.from("agent_messages").insert({
    session_id: id,
    role: "user",
    content,
  });
  if (insErr)
    return NextResponse.json({ error: insErr.message }, { status: 500 });

  if (
    isSmallTalkOnly(content) &&
    !["pending", "running", "paused", "awaiting_approval"].includes(
      String(session.status),
    )
  ) {
    await service.from("agent_messages").insert({
      session_id: id,
      role: "assistant",
      content: smallTalkAssistantReply(content),
      metadata: { kind: "small_talk" },
    });
    return NextResponse.json({ ok: true, scheduled: false });
  }

  if (userMessageLikelyResetsScope(content)) {
    await service
      .from("agent_todos")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("session_id", id)
      .in("status", ["pending", "in_progress"]);
  }

  // If the session was in a terminal pause (completed / awaiting_approval /
  // paused), bump it back to running so the ticker picks it up.
  await service
    .from("agent_sessions")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["completed", "paused", "awaiting_approval"]);

  await scheduleNextTick(id, { delayMs: 0 });
  return NextResponse.json({ ok: true });
}
