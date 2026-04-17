/**
 * POST /api/agent/tick
 *
 * Runs one tick of the agent loop for the given session and self-chains if
 * there's more work. Called internally by the ticker (via scheduleNextTick)
 * and by the cron recovery job. Can also be invoked to manually kick a
 * session.
 *
 * Auth modes (any ONE is sufficient):
 *   - Authenticated user with membership in the session's org
 *   - Request carries `x-agent-tick: 1` header and an internal AGENT_TICK_SECRET
 *     (or runs inside Vercel with VERCEL env set, i.e. server-to-server)
 *   - Cron job: `authorization: Bearer <CRON_SECRET>`
 */

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { tickSession } from "@/lib/agent/runtime/ticker";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    sessionId?: string;
    secret?: string;
  };

  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const authed = await isAuthorized(req, body);
  if (!authed) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await tickSession(body.sessionId);
  return NextResponse.json(result);
}

async function isAuthorized(
  req: Request,
  body: { sessionId?: string; secret?: string },
): Promise<boolean> {
  // 1) Internal self-chain: header + optional shared secret
  const isTickHeader = req.headers.get("x-agent-tick") === "1";
  const envSecret = process.env.AGENT_TICK_SECRET;
  if (isTickHeader) {
    if (!envSecret) return true; // unset = allow self-calls in dev
    if (body.secret && body.secret === envSecret) return true;
  }

  // 2) Cron bearer token
  const authz = req.headers.get("authorization") || "";
  if (
    process.env.CRON_SECRET &&
    authz === `Bearer ${process.env.CRON_SECRET}`
  ) {
    return true;
  }

  // 3) Authenticated user with org membership on this session
  if (!body.sessionId) return false;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const service = await createServiceClient();
  const { data: session } = await service
    .from("agent_sessions")
    .select("org_id")
    .eq("id", body.sessionId)
    .maybeSingle();
  if (!session) return false;

  const { data: mem } = await service
    .from("organization_members")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("org_id", session.org_id)
    .maybeSingle();
  return !!mem;
}
