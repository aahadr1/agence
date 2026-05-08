/**
 * Envoie un nouveau prompt utilisateur à la session OpenCode.
 * Le streaming de la réponse passe par /api/lead-agent/:chatId/stream (SSE).
 *
 * POST /api/lead-agent/:chatId/prompt body: { prompt: string }
 */
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { opencode } from "@/lib/opencode/client";

export async function POST(req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const { prompt } = (await req.json()) as { prompt?: string };
  if (!prompt?.trim()) {
    return NextResponse.json({ error: "missing_prompt" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = await createServiceClient();
  const { data: chat } = await svc
    .from("agent_chats")
    .select("opencode_session_id, user_id, title")
    .eq("id", chatId)
    .single();
  if (!chat || chat.user_id !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const oc = opencode();
  // Async prompt — returns immediately, response streams via /event
  await oc.session.prompt({
    path: { id: chat.opencode_session_id },
    body: { parts: [{ type: "text", text: prompt }] },
  });

  // Update last_message_at and title (first 60 chars of first prompt)
  const updates: { last_message_at: string; title?: string } = {
    last_message_at: new Date().toISOString(),
  };
  if (!chat.title || chat.title === "Nouvelle session") {
    updates.title = prompt.slice(0, 60).trim();
  }
  await svc.from("agent_chats").update(updates).eq("id", chatId);

  return NextResponse.json({ ok: true });
}
