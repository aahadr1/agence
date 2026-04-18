/**
 * Reflection tool — self-review entry persisted for audit + UI surfacing.
 * The engine also triggers forced reflections internally (see engine.ts).
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";

registerTool(
  {
    name: "reflect",
    description:
      "Record a self-reflection: what have you observed, what do you conclude, what's the next concrete action. Use proactively when stuck, after errors, or every 5+ tool calls.",
    parameters: {
      observation: {
        type: "string",
        description: "What you noticed about the work so far",
      },
      conclusion: {
        type: "string",
        description: "What it means / what you've learned",
      },
      next_action: {
        type: "string",
        description: "The single next concrete action you will take",
      },
      strategy_revision: {
        type: "string",
        description:
          "Optional. If your sourcing or enrichment approach must change (bad signal, wrong channel, too slow), state the new strategy in 1–3 sentences. Omit if the current plan still fits.",
        required: false,
      },
    },
    required: ["observation", "conclusion", "next_action"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) throw new Error("reflect requires a session");
    const rev = args.strategy_revision
      ? String(args.strategy_revision).trim()
      : "";
    const nextBase = String(args.next_action).slice(0, 1000);
    const nextStored =
      rev && !/^null$/i.test(rev)
        ? `${nextBase}\n\n[Strategy revision]\n${rev.slice(0, 3000)}`.slice(0, 8000)
        : nextBase;

    const { data, error } = await db
      .from("agent_reflections")
      .insert({
        session_id: context.sessionId,
        iteration: context.iterationCount,
        observation: String(args.observation).slice(0, 2000),
        conclusion: String(args.conclusion).slice(0, 2000),
        next_action: nextStored,
      })
      .select("id, observation, conclusion, next_action, iteration")
      .single();
    if (error) throw new Error(`reflect failed: ${error.message}`);
    return data;
  },
);
