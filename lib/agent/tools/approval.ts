/**
 * Approval tool — pauses the agent until the user approves or rejects.
 * The engine detects a successful call to this tool and returns status
 * "awaiting_approval" so the Inngest runner can wait on an event.
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";

registerTool(
  {
    name: "request_approval",
    description:
      "Pause the agent and ask the user to approve a sensitive or destructive action. REQUIRED before sending email, creating calendar events, spending money, publishing content, or any externally visible action. Returns { approval_id, status: 'awaiting' } — the engine will suspend until the user responds.",
    parameters: {
      action: {
        type: "string",
        description:
          "Short label for the action, e.g. 'send email', 'create calendar event'",
      },
      details: {
        type: "string",
        description:
          "Full details the user needs to approve (recipient, body, amount, etc.)",
      },
      risk: {
        type: "string",
        description: "How risky is this action?",
        enum: ["low", "medium", "high"],
      },
    },
    required: ["action", "details"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId)
      throw new Error("request_approval requires a session");
    const risk = ["low", "medium", "high"].includes(String(args.risk))
      ? String(args.risk)
      : "medium";

    const { data, error } = await db
      .from("agent_approvals")
      .insert({
        session_id: context.sessionId,
        action: String(args.action).slice(0, 200),
        details: String(args.details).slice(0, 4000),
        risk,
        status: "awaiting",
      })
      .select("id, action, details, risk, status")
      .single();
    if (error) throw new Error(`request_approval failed: ${error.message}`);

    // Mirror into the chat as a message so the UI can show a prompt
    await db.from("agent_messages").insert({
      session_id: context.sessionId,
      role: "approval_request",
      content: String(args.action),
      metadata: { approval_id: data.id, details: data.details, risk: data.risk },
    });

    // Set session state so UI can switch to "awaiting_approval"
    await db
      .from("agent_sessions")
      .update({ status: "awaiting_approval", updated_at: new Date().toISOString() })
      .eq("id", context.sessionId);

    return {
      approval_id: data.id,
      status: data.status,
      message:
        "Awaiting user approval. The agent will resume after the user responds.",
    };
  },
);

registerTool(
  {
    name: "ask_user",
    description:
      "Ask the user a clarifying question. Use sparingly (max 1-3 per session). **Pauses the agent** until the user sends their next chat message (same contract as waiting on approval). After calling this tool you must not invent answers (e.g. a city) or continue discovery in the same run — the engine stops until the user replies. **When the user has already replied** in the chat (even a short word), read that reply as the answer — do not ask again for the same detail.",
    parameters: {
      question: { type: "string", description: "The question to ask" },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Optional suggested answer choices",
        required: false,
      },
    },
    required: ["question"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId)
      throw new Error("ask_user requires a session");

    const question = String(args.question);
    const optArray = Array.isArray(args.options)
      ? (args.options as unknown[])
          .map((o) => String(o).trim())
          .filter(Boolean)
      : typeof args.options === "string"
        ? (args.options as string)
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : [];

    const { data: agentSess } = await db
      .from("agent_sessions")
      .select("id")
      .eq("id", context.sessionId)
      .maybeSingle();

    if (agentSess) {
      await db.from("agent_messages").insert({
        session_id: context.sessionId,
        role: "assistant",
        content: question,
        metadata: {
          kind: "ask_user",
          options: optArray.length ? optArray : null,
        },
      });

      await db
        .from("agent_sessions")
        .update({ status: "paused", updated_at: new Date().toISOString() })
        .eq("id", context.sessionId);
    } else {
      const missionId = context.missionId;
      const { data: missionRow } = await db
        .from("missions")
        .select("id")
        .eq("id", missionId)
        .maybeSingle();
      if (!missionRow) {
        throw new Error(
          "ask_user: id is neither an agent_sessions row nor a missions row",
        );
      }

      await db.from("mission_messages").insert({
        mission_id: missionId,
        role: "assistant",
        content: question,
        metadata: optArray.length ? { options: optArray } : {},
      });

      await db.from("missions").update({ status: "paused" }).eq("id", missionId);
    }

    return {
      asked: true,
      question,
      options: optArray.length ? optArray : null,
      message: "Question sent. Run paused until the user replies in chat.",
    };
  },
);
