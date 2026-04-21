/**
 * Active user intent for an agent session: consolidated brief from all user
 * turns (fixes "first message only" drift) + scope-change detection for todo reset.
 */

import { getAgentDb } from "@/lib/agent/tools/_db";

/**
 * Full brief for the LLM: initial message + follow-ups with explicit priority
 * when instructions contradict each other.
 */
export async function fetchActiveUserBrief(sessionId: string): Promise<string> {
  const db = getAgentDb();
  const { data: rows } = await db
    .from("agent_messages")
    .select("content")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: true });

  if (!rows?.length) return "";
  if (rows.length === 1) return rows[0].content || "";

  const first = rows[0].content || "";
  const tail = rows
    .slice(1)
    .map((r, i) => `${i + 1}. ${r.content || ""}`)
    .join("\n");
  return (
    `[Brief initial]\n${first}\n\n` +
    `[Messages utilisateur suivants — en cas de contradiction (ville, nombre, périmètre), la **dernière** consigne fait foi]\n${tail}`
  );
}

/**
 * Heuristic: user explicitly changes city / abandons the current search scope.
 * Used to cancel open todos so the agent can replan (Nancy → Bordeaux case).
 */
export function userMessageLikelyResetsScope(content: string): boolean {
  const t = content.trim();
  if (t.length < 6) return false;
  if (/\b(?:oubliez?|oublie|forget)\b/i.test(t)) return true;
  if (/\b(?:on\s+part\s+sur|plut[oô]t|instead|rather|pas\s+(?:nancy|ça|ce\s+ci))\b/i.test(t))
    return true;
  if (/\bautre\s+ville\b/i.test(t)) return true;
  if (/\b(?:change|changer)\s+(?:de\s+)?(?:ville|zone|périmètre)\b/i.test(t))
    return true;
  if (/\b(?:nouvelle|new)\s+(?:ville|zone|recherche)\b/i.test(t)) return true;
  return false;
}
