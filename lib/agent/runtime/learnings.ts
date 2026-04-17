/**
 * Learnings = durable cross-session memory of what works and what doesn't.
 *
 * - At any point the agent can call `learn_record` to persist a lesson.
 * - Future sessions in the same org automatically get the top-K most confident
 *   learnings injected into the system prompt (filtered by current capability
 *   packs to stay relevant).
 *
 * This is the auto-feedback loop that makes the agent improve over time.
 */

import { getAgentDb } from "@/lib/agent/tools/_db";
import type { CapabilityPack } from "@/lib/agent/types";

/** Top-K learnings to inject per scope */
const TOP_K_PER_SCOPE = 5;

/** Always also include this many from 'general' */
const TOP_K_GENERAL = 5;

interface LearningRow {
  title: string;
  content: string;
  scope: string;
  confidence: number;
  triggers: string[];
}

export async function injectLearnings(
  baseSystemPrompt: string,
  opts: { orgId: string; scopes: CapabilityPack[] },
): Promise<string> {
  try {
    const db = getAgentDb();
    const scopes = [
      "general",
      ...(opts.scopes || []).map((s) => String(s)),
    ];

    const { data } = await db
      .from("agent_learnings")
      .select("title, content, scope, confidence, triggers")
      .eq("org_id", opts.orgId)
      .eq("archived", false)
      .in("scope", scopes)
      .order("confidence", { ascending: false })
      .limit(50);

    const learnings = (data || []) as LearningRow[];
    if (learnings.length === 0) return baseSystemPrompt;

    // Group by scope, take top-K each
    const byScope = new Map<string, LearningRow[]>();
    for (const l of learnings) {
      const arr = byScope.get(l.scope) || [];
      arr.push(l);
      byScope.set(l.scope, arr);
    }
    const picked: LearningRow[] = [];
    for (const [scope, arr] of byScope.entries()) {
      const k = scope === "general" ? TOP_K_GENERAL : TOP_K_PER_SCOPE;
      picked.push(...arr.slice(0, k));
    }
    if (picked.length === 0) return baseSystemPrompt;

    const lines: string[] = [];
    lines.push("<LEARNED_FROM_PAST_SESSIONS>");
    lines.push(
      "The following lessons were recorded by past runs. Apply them when relevant. If a lesson is wrong, record a corrective learning via `learn_record`.",
    );
    for (const l of picked) {
      const trig =
        l.triggers && l.triggers.length > 0
          ? ` (when: ${l.triggers.join(", ")})`
          : "";
      lines.push(`- [${l.scope}] ${l.title}${trig}: ${l.content}`);
    }
    lines.push("</LEARNED_FROM_PAST_SESSIONS>");
    return `${baseSystemPrompt}\n\n${lines.join("\n")}`;
  } catch (e) {
    console.warn("[agent.learnings] inject failed:", e);
    return baseSystemPrompt;
  }
}
