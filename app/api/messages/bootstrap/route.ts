import { ensureAgencyOrgContext } from "@/lib/org/ensure-agency-context";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Ensure #general channel exists for the org and current user is a member. */
export async function POST() {
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

  const { orgId, admin } = ctx;

  const { data: existing, error: findErr } = await admin
    .from("conversations")
    .select("id")
    .eq("org_id", orgId)
    .eq("type", "channel")
    .eq("slug", "general")
    .maybeSingle();

  if (findErr) {
    console.error("[bootstrap] find general:", findErr);
    return NextResponse.json(
      { error: findErr.message },
      { status: 500 }
    );
  }

  let convId = existing?.id;
  /** True only when this request inserted the #general row (not a duplicate-key race). */
  let createdChannelThisRequest = false;

  if (!convId) {
    const { data: conv, error: insertErr } = await admin
      .from("conversations")
      .insert({
        org_id: orgId,
        type: "channel",
        title: "general",
        slug: "general",
        is_private: false,
        created_by: user.id,
      })
      .select("id")
      .single();

    if (insertErr) {
      const code = (insertErr as { code?: string }).code;
      if (code === "23505") {
        const { data: again } = await admin
          .from("conversations")
          .select("id")
          .eq("org_id", orgId)
          .eq("type", "channel")
          .eq("slug", "general")
          .maybeSingle();
        convId = again?.id;
      } else {
        console.error("[bootstrap] insert general:", insertErr);
        return NextResponse.json(
          { error: insertErr.message },
          { status: 500 }
        );
      }
    } else if (conv) {
      convId = conv.id;
      createdChannelThisRequest = true;
    }
  }

  if (!convId) {
    return NextResponse.json(
      { error: "Could not resolve #general channel" },
      { status: 500 }
    );
  }

  const { data: already } = await admin
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", convId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!already) {
    const { error: memErr } = await admin.from("conversation_members").insert({
      conversation_id: convId,
      user_id: user.id,
      role: "member",
    });
    if (memErr) {
      console.error("[bootstrap] add self to general:", memErr);
      return NextResponse.json(
        { error: memErr.message },
        { status: 500 }
      );
    }
  }

  if (createdChannelThisRequest) {
    const { data: orgMembers } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("org_id", orgId);

    const memberRows = (orgMembers || [])
      .filter((m) => m.user_id !== user.id)
      .map((m) => ({
        conversation_id: convId,
        user_id: m.user_id,
        role: "member" as const,
      }));

    for (const row of memberRows) {
      const { error: e } = await admin.from("conversation_members").insert(row);
      if (e && (e as { code?: string }).code !== "23505") {
        console.error("[bootstrap] add org member to general:", e);
      }
    }
  }

  return NextResponse.json({
    conversationId: convId,
    created: createdChannelThisRequest,
    joinedGeneral: !already,
  });
}
