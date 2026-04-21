/**
 * Parse explicit lead/list counts from user prompts ("10 restaurants", "30 leads").
 */

import { getAgentDb } from "@/lib/agent/tools/_db";

/** Parse a numeric target from a single block of text (one user message or a merged brief). */
export function parseLeadTargetFromText(prompt: string): number | null {
  const p = prompt.trim();
  const m1 = p.match(
    /\b(\d{1,3})\s*(?:leads?|prospects?|professionnels?|lignes?|candidats?)\b/i,
  );
  if (m1) return Math.min(500, Math.max(1, parseInt(m1[1], 10)));
  const mRestaurant = p.match(
    /\b(\d{1,3})\s*(?:restaurants?|établissements?|commerces?|boutiques?)\b/i,
  );
  if (mRestaurant)
    return Math.min(500, Math.max(1, parseInt(mRestaurant[1], 10)));
  const m2 = p.match(
    /\b(?:liste|tableau)\s+(?:de|d['']|d')\s*(\d{1,3})\b/i,
  );
  if (m2) return Math.min(500, Math.max(1, parseInt(m2[1], 10)));
  return null;
}

/** @deprecated prefer parseLeadTargetFromText — kept for call-site clarity */
export function parseLeadTargetFromUserPrompt(prompt: string): number | null {
  return parseLeadTargetFromText(prompt);
}

/**
 * Newest user message that contains an explicit count wins (e.g. correction
 * "5 seulement" overrides the initial "10 restaurants").
 */
export async function fetchLeadTargetForSession(
  sessionId: string,
): Promise<number | null> {
  const db = getAgentDb();
  const { data } = await db
    .from("agent_messages")
    .select("content")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: false });
  if (!data?.length) return null;
  for (const row of data) {
    const t = parseLeadTargetFromText(row.content || "");
    if (t != null) return t;
  }
  return null;
}
