/**
 * Cron: recover stuck agent sessions.
 *
 * Runs every minute (see vercel.json). Looks for sessions that should be
 * making progress but haven't ticked in a while, and reschedules them.
 *
 * Also checks `awaiting_approval` sessions for a matching answered approval
 * row and wakes them up (handles the case where the approval webhook fired
 * while the runner was offline).
 *
 * Secured with `authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
 */

import { NextResponse } from "next/server";
import { getAgentDb } from "@/lib/agent/tools/_db";
import { scheduleNextTick } from "@/lib/agent/runtime/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

// A session is considered stuck if it's `running` but hasn't ticked for this
// many seconds. The soft deadline inside a single tick is ~270 s, so 180 s
// past the last tick means something crashed.
const STUCK_AFTER_SEC = 180;

export async function GET(req: Request) {
  if (process.env.CRON_SECRET) {
    const expected = `Bearer ${process.env.CRON_SECRET}`;
    if (req.headers.get("authorization") !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  return runRecovery();
}

// Vercel Cron uses GET; also allow POST for manual triggering.
export async function POST(req: Request) {
  return GET(req);
}

async function runRecovery() {
  const db = getAgentDb();
  const cutoff = new Date(Date.now() - STUCK_AFTER_SEC * 1000).toISOString();

  // 1) Stuck `running` sessions — rekick them
  const { data: stuck } = await db
    .from("agent_sessions")
    .select("id, last_tick_at")
    .eq("status", "running")
    .or(`last_tick_at.is.null,last_tick_at.lt.${cutoff}`)
    .limit(25);

  const rekicked: string[] = [];
  for (const row of stuck || []) {
    await scheduleNextTick(row.id, { delayMs: 0 });
    rekicked.push(row.id);
  }

  // 2) Pending sessions that never got their first tick
  const { data: pending } = await db
    .from("agent_sessions")
    .select("id, created_at")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - 30_000).toISOString())
    .limit(25);

  const started: string[] = [];
  for (const row of pending || []) {
    await scheduleNextTick(row.id, { delayMs: 0 });
    started.push(row.id);
  }

  // 3) awaiting_approval sessions whose approval has been answered
  const { data: waiting } = await db
    .from("agent_sessions")
    .select("id")
    .eq("status", "awaiting_approval")
    .limit(100);

  const resumed: string[] = [];
  for (const row of waiting || []) {
    const { data: answered } = await db
      .from("agent_approvals")
      .select("id, status, responded_at")
      .eq("session_id", row.id)
      .in("status", ["approved", "rejected"])
      .order("responded_at", { ascending: false })
      .limit(1);
    if (answered && answered.length > 0) {
      await db
        .from("agent_sessions")
        .update({
          status: "running",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      await scheduleNextTick(row.id, { delayMs: 0 });
      resumed.push(row.id);
    }
  }

  return NextResponse.json({
    rekicked: rekicked.length,
    started: started.length,
    resumed_from_approval: resumed.length,
    details: { rekicked, started, resumed },
  });
}
