/**
 * Inngest: agent session runner.
 *
 * session-start   : first event for a new session. Loads the full state from
 *                   Supabase, runs the agent loop, persists results.
 * session-continue: user sent a follow-up message mid-session.
 * approval-responded: user approved/rejected a pending action; resume.
 *
 * To keep things simple, all three converge on the same execution path by
 * calling runSession(sessionId, opts). Inngest step durability protects us
 * from timeouts.
 */

import { inngest } from "../client";
import type { AgentContext, AgentModel, CapabilityPack } from "@/lib/agent/types";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function getDb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

interface SessionRow {
  id: string;
  org_id: string;
  user_id: string;
  status: string;
  model: string;
  capability_packs: string[];
  domain_instructions: string | null;
  budget_cap_cents: number | null;
  cost_cents: number;
}

export async function runSession(
  sessionId: string,
  opts: { userMessage?: string } = {},
) {
  const db = getDb();
  const { data: session, error } = await db
    .from("agent_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle<SessionRow>();
  if (error || !session)
    throw new Error(`session not found: ${error?.message || "missing"}`);

  await db
    .from("agent_sessions")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", sessionId);

  // Lazy-load heavy deps (playwright, tools registry, engine)
  const { runAgentLoop } = await import("@/lib/agent/engine");
  const { buildSystemPrompt, getToolNamesForCapabilities } = await import(
    "@/lib/agent/orchestrator"
  );
  const { executeTool, getToolDefinitions } = await import(
    "@/lib/agent/tools"
  );

  const packs = (session.capability_packs || []) as CapabilityPack[];
  const systemPrompt = buildSystemPrompt({
    capabilities: packs,
    domainInstructions: session.domain_instructions || undefined,
  });
  const toolNames = getToolNamesForCapabilities(packs);
  const tools = getToolDefinitions(toolNames);

  const context: AgentContext = {
    missionId: sessionId,
    sessionId,
    orgId: session.org_id,
    userId: session.user_id,
    scratchpad: new Map(),
    totalCostCents: session.cost_cents || 0,
    budgetCapCents: session.budget_cap_cents,
    iterationCount: 0,
    maxIterations: 40,
    capabilityPacks: packs,
    inputTokensSoFar: 0,
  };

  const userMessage = opts.userMessage ?? (await fetchInitialPrompt(db, sessionId));

  const result = await runAgentLoop(
    {
      systemPrompt,
      tools,
      model: (session.model as AgentModel) || "gemini-2.5-pro",
      maxIterations: 40,
      reflectEveryN: 5,
      onThinking: async (text) => {
        await db.from("agent_messages").insert({
          session_id: sessionId,
          role: "thinking",
          content: text,
        });
      },
      onMessage: async (text) => {
        await db.from("agent_messages").insert({
          session_id: sessionId,
          role: "assistant",
          content: text,
        });
      },
      onToolCall: async (name, params) => {
        await db.from("agent_messages").insert({
          session_id: sessionId,
          role: "system",
          content: `→ ${name}`,
          metadata: { tool: name, params },
        });
      },
      onToolResult: async (toolResult) => {
        await db.from("agent_messages").insert({
          session_id: sessionId,
          role: "system",
          content: toolResult.error
            ? `${toolResult.name} failed: ${toolResult.error}`
            : `${toolResult.name} ok (${toolResult.durationMs}ms)`,
          metadata: {
            tool: toolResult.name,
            error: toolResult.error || null,
            duration_ms: toolResult.durationMs,
          },
        });
      },
      onReflection: async (r) => {
        await db.from("agent_reflections").insert({
          session_id: sessionId,
          iteration: r.iteration,
          observation: r.observation,
          conclusion: r.conclusion,
          next_action: r.nextAction,
        });
      },
    },
    context,
    executeTool,
    userMessage,
  );

  const finalStatus =
    result.status === "awaiting_approval"
      ? "awaiting_approval"
      : result.status === "budget_exhausted"
        ? "paused"
        : result.status === "max_iterations"
          ? "paused"
          : "completed";

  await db
    .from("agent_sessions")
    .update({
      status: finalStatus,
      cost_cents: Math.round(result.totalCostCents),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  return {
    status: result.status,
    iterations: result.iterations,
    costCents: result.totalCostCents,
    approvalId: result.pendingApprovalId,
  };
}

async function fetchInitialPrompt(
  db: SupabaseClient,
  sessionId: string,
): Promise<string> {
  const { data } = await db
    .from("agent_messages")
    .select("content")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.content || "Hello";
}

// ---------------------------------------------------------------------------
// Inngest functions
// ---------------------------------------------------------------------------

type InngestStep = { run: (name: string, fn: () => unknown) => Promise<unknown> };

export const sessionStart = inngest.createFunction(
  {
    id: "agent-session-start",
    retries: 1,
    concurrency: [{ limit: 5 }],
    triggers: [{ event: "agent/session.start" }],
  },
  async ({
    event,
    step,
  }: {
    event: { data: { sessionId: string } };
    step: InngestStep;
  }) => {
    const { sessionId } = event.data;
    return step.run("run", () => runSession(sessionId));
  },
);

export const sessionContinue = inngest.createFunction(
  {
    id: "agent-session-continue",
    retries: 1,
    concurrency: [{ limit: 5 }],
    triggers: [{ event: "agent/session.continue" }],
  },
  async ({
    event,
    step,
  }: {
    event: { data: { sessionId: string; userMessage?: string } };
    step: InngestStep;
  }) => {
    const { sessionId, userMessage } = event.data;
    return step.run("run", () => runSession(sessionId, { userMessage }));
  },
);

export const approvalResponded = inngest.createFunction(
  {
    id: "agent-approval-responded",
    retries: 1,
    concurrency: [{ limit: 5 }],
    triggers: [{ event: "agent/approval.responded" }],
  },
  async ({
    event,
    step,
  }: {
    event: {
      data: {
        sessionId: string;
        decision: "approve" | "reject";
        comment: string | null;
      };
    };
    step: InngestStep;
  }) => {
    const { sessionId, decision, comment } = event.data;
    return step.run("run", () =>
      runSession(sessionId, {
        userMessage: `The user ${
          decision === "approve" ? "APPROVED" : "REJECTED"
        } the pending action${comment ? ` with comment: ${comment}` : ""}. ${
          decision === "approve"
            ? "Proceed."
            : "Do NOT execute that action. Acknowledge and continue with alternatives."
        }`,
      }),
    );
  },
);
