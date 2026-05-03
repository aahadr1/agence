/**
 * Scratchpad DB persistence only — no tool-registry import (avoids circular
 * deps: tool-registry → local-browser-worker → google-maps-persistence → here).
 */

import { getAgentDb } from "./tools/_db";

const PREFIX = "scratchpad:";

export function scratchpadStorageKey(userKey: string): string {
  const k = String(userKey).replace(/[\u0000-\u001f]/g, "").trim().slice(0, 180);
  return `${PREFIX}${k || "_empty"}`;
}

export async function writeScratchpadText(
  sessionId: string,
  key: string,
  text: string,
): Promise<void> {
  const db = getAgentDb();
  const { error } = await db.from("agent_memory").upsert(
    {
      session_id: sessionId,
      key: scratchpadStorageKey(key),
      value: { text },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id,key" },
  );
  if (error) throw new Error(`scratchpad_write failed: ${error.message}`);
}
