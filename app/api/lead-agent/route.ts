/**
 * Crée une nouvelle conversation (chat) côté Supabase + côté OpenCode.
 *
 * POST /api/lead-agent → { chat: AgentChat }
 */
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { opencode } from "@/lib/opencode/client";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const oc = opencode();
  const session = await oc.session.create({
    body: { title: `web-${user.id.slice(0, 8)}-${new Date().toISOString().slice(0, 16)}` },
  });
  if (!session.data?.id) {
    return NextResponse.json({ error: "opencode_session_failed" }, { status: 502 });
  }

  const svc = await createServiceClient();
  const { data: chat, error } = await svc
    .from("agent_chats")
    .insert({
      user_id: user.id,
      opencode_session_id: session.data.id,
      title: "Nouvelle session",
    })
    .select("id, opencode_session_id, title, created_at, last_message_at")
    .single();

  if (error || !chat) {
    return NextResponse.json({ error: error?.message ?? "db_insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ chat });
}
