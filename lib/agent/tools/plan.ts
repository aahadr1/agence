/**
 * Plan tools — higher-level than todos. A plan is a small roadmap you show to
 * the user for alignment BEFORE executing. Use todos to actually track work.
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";

registerTool(
  {
    name: "plan_create",
    description:
      "Create a high-level plan for the session (goal + 3-10 major steps). Call ONCE per session, before heavy work. The previous plan (if any) becomes non-current. Use todo_write for execution-level tracking.",
    parameters: {
      goal: {
        type: "string",
        description: "One-sentence goal summary",
      },
      steps: {
        type: "array",
        description:
          "Ordered list of plan steps. Each: { label, description, estimatedMinutes?: number }",
      },
    },
    required: ["goal", "steps"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) throw new Error("plan_create requires a session");

    await db
      .from("agent_plans")
      .update({ is_current: false })
      .eq("session_id", context.sessionId)
      .eq("is_current", true);

    const { data: latest } = await db
      .from("agent_plans")
      .select("version")
      .eq("session_id", context.sessionId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const version = (latest?.version || 0) + 1;

    const { data, error } = await db
      .from("agent_plans")
      .insert({
        session_id: context.sessionId,
        version,
        goal: String(args.goal).slice(0, 500),
        steps: args.steps,
        is_current: true,
      })
      .select("id, version, goal, steps")
      .single();
    if (error) throw new Error(`plan_create failed: ${error.message}`);
    return data;
  },
);

registerTool(
  {
    name: "plan_revise",
    description:
      "Revise the current plan with a new version. Provide a revision reason so the user understands why.",
    parameters: {
      reason: { type: "string", description: "Why you're revising" },
      goal: { type: "string", description: "Updated goal" },
      steps: { type: "array", description: "Updated ordered steps" },
    },
    required: ["reason", "goal", "steps"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) throw new Error("plan_revise requires a session");

    await db
      .from("agent_plans")
      .update({ is_current: false })
      .eq("session_id", context.sessionId)
      .eq("is_current", true);

    const { data: latest } = await db
      .from("agent_plans")
      .select("version")
      .eq("session_id", context.sessionId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const version = (latest?.version || 0) + 1;

    const { data, error } = await db
      .from("agent_plans")
      .insert({
        session_id: context.sessionId,
        version,
        goal: String(args.goal).slice(0, 500),
        steps: args.steps,
        revision_reason: String(args.reason).slice(0, 1000),
        is_current: true,
      })
      .select("id, version, goal, steps, revision_reason")
      .single();
    if (error) throw new Error(`plan_revise failed: ${error.message}`);
    return data;
  },
);
