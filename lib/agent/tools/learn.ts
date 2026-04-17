/**
 * Self-improvement tools.
 *
 * - `learn_record` lets the agent persist a durable lesson that future
 *   sessions (in the same org) will see injected into their system prompt.
 * - `learn_recall` lets the agent fetch lessons on demand (useful when it
 *   suspects it has seen a similar situation before).
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";

registerTool(
  {
    name: "learn_record",
    description:
      "Persist a durable lesson for future sessions. Use after completing a non-trivial task when you discover a pattern, pitfall, or optimization worth remembering. Keep it concise (1-2 sentences) and actionable.",
    parameters: {
      title: {
        type: "string",
        description: "Short title of the learning (max 80 chars)",
      },
      content: {
        type: "string",
        description: "The lesson itself. Ideally 1-3 sentences, actionable.",
      },
      scope: {
        type: "string",
        description:
          "One of: general, lead-gen-fr, email, calendar, web-research, browser. Defaults to 'general'.",
      },
      triggers: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional short phrases describing when this lesson applies (e.g. 'sending cold emails', 'parsing French business directories')",
      },
      confidence: {
        type: "number",
        description:
          "Your confidence that the lesson is correct and useful (0..1). Default 0.6.",
      },
    },
    required: ["title", "content"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    const scope = String(args.scope || "general").slice(0, 40);
    const title = String(args.title).slice(0, 200);
    const content = String(args.content).slice(0, 4000);
    const triggers = Array.isArray(args.triggers)
      ? (args.triggers as unknown[]).map((t) => String(t).slice(0, 120))
      : [];
    const confidence = clamp01(Number(args.confidence ?? 0.6));

    const { data, error } = await db
      .from("agent_learnings")
      .insert({
        org_id: context.orgId,
        user_id: context.userId,
        session_id: context.sessionId,
        scope,
        title,
        content,
        triggers,
        confidence,
      })
      .select("id")
      .single();

    if (error) throw new Error(`learn_record failed: ${error.message}`);
    return { id: data.id, ok: true };
  },
);

registerTool(
  {
    name: "learn_recall",
    description:
      "Fetch past lessons matching a scope and/or keyword. Useful when you want to look up how similar tasks were approached in previous sessions.",
    parameters: {
      scope: {
        type: "string",
        description:
          "Optional scope filter (general, lead-gen-fr, email, calendar, web-research, browser).",
      },
      keyword: {
        type: "string",
        description:
          "Optional keyword; matches against title and content (case-insensitive substring).",
      },
      limit: {
        type: "number",
        description: "Max results (default 10, max 25).",
      },
    },
    required: [],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    let q = db
      .from("agent_learnings")
      .select("id, title, content, scope, confidence, triggers, created_at")
      .eq("org_id", context.orgId)
      .eq("archived", false)
      .order("confidence", { ascending: false })
      .limit(Math.min(25, Math.max(1, Number(args.limit) || 10)));

    if (args.scope) q = q.eq("scope", String(args.scope));
    if (args.keyword) {
      const k = String(args.keyword).replace(/[%_]/g, "");
      q = q.or(`title.ilike.%${k}%,content.ilike.%${k}%`);
    }
    const { data } = await q;
    return { learnings: data || [] };
  },
);

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
