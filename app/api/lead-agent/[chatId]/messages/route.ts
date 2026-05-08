/**
 * Récupère l'historique des messages d'une conversation.
 *
 * GET /api/lead-agent/:chatId/messages → { messages: ChatMessage[] }
 */
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { opencode } from "@/lib/opencode/client";

interface OcPart {
  type: string;
  text?: string;
  tool?: string;
  state?: { status?: string };
}

export async function GET(_req: Request, ctx: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = await createServiceClient();
  const { data: chat } = await svc
    .from("agent_chats")
    .select("opencode_session_id, user_id")
    .eq("id", chatId)
    .single();
  if (!chat || chat.user_id !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const oc = opencode();
  const messagesRes = await oc.session.messages({ path: { id: chat.opencode_session_id } });
  const raw = (messagesRes.data ?? []) as Array<{
    info: { id: string; role: "user" | "assistant" };
    parts?: OcPart[];
  }>;

  const messages: Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    toolCalls?: Array<{ name: string; status: "done" | "error" }>;
  }> = [];

  for (const m of raw) {
    const parts = m.parts ?? [];
    const text = parts
      .filter((p: OcPart) => p.type === "text" && typeof p.text === "string")
      .map((p: OcPart) => p.text ?? "")
      .join("\n");

    if (m.info.role === "user") {
      messages.push({ id: m.info.id, role: "user", text });
    } else {
      const toolCalls = parts
        .filter((p: OcPart) => p.type === "tool" && p.tool)
        .map((p: OcPart) => ({
          name: p.tool ?? "tool",
          status: (p.state?.status === "completed" ? "done" : "error") as "done" | "error",
        }));
      messages.push({ id: m.info.id, role: "assistant", text, toolCalls });
    }
  }

  return NextResponse.json({ messages });
}
