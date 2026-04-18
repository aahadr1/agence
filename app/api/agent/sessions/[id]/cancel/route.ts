import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";

export const runtime = "nodejs";

const STOPPABLE = new Set([
  "pending",
  "planning",
  "running",
  "paused",
  "awaiting_approval",
]);

/**
 * POST — stop the autonomous agent (same idea as "Stop" on ChatGPT).
 * Sets session to `cancelled`; the next tick (if any) will not reschedule.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: sessionId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const service = await createServiceClient();

  const { data: session, error: loadErr } = await service
    .from("agent_sessions")
    .select("id, status")
    .eq("id", sessionId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (loadErr || !session)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!STOPPABLE.has(session.status)) {
    return NextResponse.json(
      {
        ok: false,
        message: `La session est déjà « ${session.status} » — rien à arrêter.`,
      },
      { status: 409 },
    );
  }

  const { error: updErr } = await service
    .from("agent_sessions")
    .update({
      status: "cancelled",
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("org_id", orgId);

  if (updErr)
    return NextResponse.json({ error: updErr.message }, { status: 500 });

  await service.from("agent_messages").insert({
    session_id: sessionId,
    role: "assistant",
    content:
      "Session arrêtée sur ta demande. Les messages et leads déjà enregistrés restent visibles ci-dessus.",
  });

  return NextResponse.json({ ok: true, status: "cancelled" });
}
