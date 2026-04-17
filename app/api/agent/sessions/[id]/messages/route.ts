import { NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

async function dispatchContinue(sessionId: string, userMessage: string) {
  if (process.env.INNGEST_EVENT_KEY) {
    try {
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "agent/session.continue",
        data: { sessionId, userMessage },
      });
      return;
    } catch (e) {
      console.warn("[agent] inngest.send failed, falling back inline:", e);
    }
  }
  after(async () => {
    try {
      const { runSession } = await import(
        "@/lib/inngest/functions/session-run"
      );
      await runSession(sessionId, { userMessage });
    } catch (e) {
      console.error("[agent] inline runSession failed:", e);
    }
  });
}

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
  if (!body.content?.trim())
    return NextResponse.json({ error: "content required" }, { status: 400 });

  const service = await createServiceClient();
  const { error: insErr } = await service.from("agent_messages").insert({
    session_id: id,
    role: "user",
    content: body.content.trim(),
  });
  if (insErr)
    return NextResponse.json({ error: insErr.message }, { status: 500 });

  await dispatchContinue(id, body.content.trim());
  return NextResponse.json({ ok: true });
}
