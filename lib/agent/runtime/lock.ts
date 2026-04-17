/**
 * Session lock helpers.
 *
 * We use a Postgres-side RPC (`agent_try_lock_session`) to atomically acquire
 * or refresh a TTL-based lease on an agent session. This prevents two ticks
 * from running concurrently even when multiple Vercel instances are warm.
 */

import { randomUUID } from "node:crypto";
import { getAgentDb } from "../tools/_db";

export interface SessionLock {
  sessionId: string;
  token: string;
  ttlSec: number;
  acquiredAt: number;
}

export async function acquireLock(
  sessionId: string,
  ttlSec = 120,
): Promise<SessionLock | null> {
  const db = getAgentDb();
  const token = randomUUID();
  const { data, error } = await db.rpc("agent_try_lock_session", {
    p_session_id: sessionId,
    p_token: token,
    p_ttl_sec: ttlSec,
  });
  if (error) {
    console.error("[agent.lock] rpc error", error);
    return null;
  }
  if (data !== true) return null;
  return { sessionId, token, ttlSec, acquiredAt: Date.now() };
}

export async function refreshLock(lock: SessionLock): Promise<boolean> {
  const db = getAgentDb();
  const { data } = await db.rpc("agent_try_lock_session", {
    p_session_id: lock.sessionId,
    p_token: lock.token,
    p_ttl_sec: lock.ttlSec,
  });
  return data === true;
}

export async function releaseLock(lock: SessionLock): Promise<void> {
  const db = getAgentDb();
  try {
    await db.rpc("agent_release_session", {
      p_session_id: lock.sessionId,
      p_token: lock.token,
    });
  } catch (e) {
    console.warn("[agent.lock] release failed (will expire via TTL)", e);
  }
}
