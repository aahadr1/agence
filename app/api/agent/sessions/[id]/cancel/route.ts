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
    .select("id, status, org_id")
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

  const { count } = await service
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", session.org_id)
    .contains("enrichment_data", { agent_session_id: sessionId });

  const n = count ?? 0;

  let snapLine = "";
  try {
    const { count: snapCount } = await service
      .from("agent_discovery_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);
    const snaps = snapCount ?? 0;
    if (snaps > 0) {
      snapLine = ` Lots Maps persistés (serveur) : ${snaps}.`;
    }
  } catch {
    /* table may not exist before migration */
  }

  await service.from("agent_messages").insert({
    session_id: sessionId,
    role: "assistant",
    content:
      `Session arrêtée sur ta demande. Prospects CRM enregistrés pour cette session : ${n}.${snapLine} ` +
      `Les messages utiles restent visibles ci-dessus.`,
  });

  return NextResponse.json({ ok: true, status: "cancelled" });
}
