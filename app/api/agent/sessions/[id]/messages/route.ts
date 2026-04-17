import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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
