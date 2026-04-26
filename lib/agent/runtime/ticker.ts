/**
 * Autonomous runtime ticker.
 *
 * A "tick" is a bounded unit of agent work executed inside a single serverless
 * invocation. Each tick:
 *   1. Acquires a Postgres-level lock on the session (prevents double-runs).
 *   2. Loads session state + prior history from Supabase.
 *   3. Runs `runAgentLoop` with a TIGHT budget (time + iterations).
 *   4. Persists outputs (messages, reflections, cost).
 *   5. Decides whether to schedule another tick or stop.
 *
 * If the tick succeeds but the agent isn't done yet, we self-chain via an
 * outbound HTTP call to /api/agent/tick. If we crash, the cron recovery job
 * notices the stale `last_tick_at` and relaunches.
 *
 * This module REPLACES the old Inngest-based runner.
 */

import { randomUUID } from "node:crypto";
import type {
  AgentContext,
  AgentModel,
  CapabilityPack,
  ToolDefinition,
} from "@/lib/agent/types";
import { acquireLock, releaseLock } from "./lock";
import { withRetry, isLikelyTransient, sleep } from "./retry";
import { scheduleNextTick } from "./schedule";
import { getAgentDb } from "@/lib/agent/tools/_db";
import { fetchLeadTargetForSession } from "@/lib/agent/lead-target";
import {
  buildContinuationUserMessage,
  buildLeadGenMissionContextAppendix,
} from "@/lib/agent/mission-prompt";
import type { AgentMessage } from "@/lib/ai/llm-router";

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/**
 * Hard deadline for one tick. Vercel's default is 300s (we set maxDuration=300
 * on the route too); we stop 30s earlier to guarantee we can cleanly hand off
 * to the next tick without getting killed mid-write.
 */
const TICK_SOFT_DEADLINE_MS = 270_000;

/** Default max agent-loop iterations per tick before yielding. */
const ITER_PER_TICK = 8;

/** Lead-gen sessions get a higher per-tick iteration budget (multi-tool retries, no rigid script). */
const ITER_PER_TICK_LEAD_GEN = 20;

/** Hard cap on chained ticks per session (~20 × 270s ≈ 90 min wall time). */
const MAX_TICKS_PER_SESSION = 30;

/** Lock lease length. Must exceed worst-case tick duration. */
const LOCK_TTL_SEC = 300;

/** Max automatic retries of a failing tick before we mark session as failed. */
const MAX_TICK_RETRIES = 3;

// -----------------------------------------------------------------------------
// Session row shape
// -----------------------------------------------------------------------------

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
  tick_count: number;
  attempt_count: number;
  last_error: string | null;
  /** Legacy link to missions row; null for pure agent_sessions runs */
  mission_id: string | null;
}

// -----------------------------------------------------------------------------
// Public entry point
// -----------------------------------------------------------------------------

export interface TickResult {
  sessionId: string;
  status: string;
  didWork: boolean;
  willContinue: boolean;
  iterations: number;
  costCents: number;
  errorMessage?: string;
}

/**
 * Run one tick for a session. If the session is done (completed / failed /
 * awaiting_approval / paused), returns quickly without doing work.
 */
export async function tickSession(sessionId: string): Promise<TickResult> {
  const lock = await acquireLock(sessionId, LOCK_TTL_SEC);
  if (!lock) {
    // Someone else is running it right now. That's fine — we return.
    return {
      sessionId,
      status: "locked_by_other",
      didWork: false,
      willContinue: false,
      iterations: 0,
      costCents: 0,
    };
  }

  try {
    return await runOneTickLocked(sessionId);
  } finally {
    await releaseLock(lock);
  }
}

// -----------------------------------------------------------------------------
// Internal: one locked tick
// -----------------------------------------------------------------------------

async function runOneTickLocked(sessionId: string): Promise<TickResult> {
  const db = getAgentDb();
  const startedAt = Date.now();

  const { data: session } = await db
    .from("agent_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle<SessionRow>();

  if (!session) {
    return {
      sessionId,
      status: "missing",
      didWork: false,
      willContinue: false,
      iterations: 0,
      costCents: 0,
      errorMessage: "session not found",
    };
  }

  // Terminal states: don't touch. `paused` waits for user input (ask_user,
  // budget pause) — do not self-chain another tick until they post a message.
  if (
    ["completed", "failed", "cancelled", "awaiting_approval", "paused"].includes(
      session.status,
    )
  ) {
    return {
      sessionId,
      status: session.status,
      didWork: false,
      willContinue: false,
      iterations: 0,
      costCents: 0,
    };
  }

  const sessionPacksForBudget = (session.capability_packs || []) as CapabilityPack[];
  const iterBudget = sessionPacksForBudget.includes("lead-gen-fr")
    ? ITER_PER_TICK_LEAD_GEN
    : ITER_PER_TICK;
  // V1 keeps reflection out of the tool loop. The model has only five tools
  // and the prompt asks it to adapt directly from evidence.
  const reflectEveryN = 0;

  // Journal the step (best-effort, non-fatal)
  const stepNum = (session.tick_count || 0) + 1;

  if (stepNum > MAX_TICKS_PER_SESSION) {
    await db
      .from("agent_sessions")
      .update({
        status: "completed",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
    await db.from("agent_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content:
        `Limite d’exécution automatique atteinte (${MAX_TICKS_PER_SESSION} ticks). ` +
        `Les résultats partiels sont conservés ci-dessus — poursuis manuellement si besoin.`,
    });
    return {
      sessionId,
      status: "completed",
      didWork: false,
      willContinue: false,
      iterations: 0,
      costCents: 0,
    };
  }

  const stepId = randomUUID();
  await db.from("agent_session_steps").insert({
    id: stepId,
    session_id: sessionId,
    step_num: stepNum,
    status: "running",
    attempt: (session.attempt_count || 0) + 1,
    input: { iter_budget: iterBudget },
  });

  // Mark session running + heartbeat
  await db
    .from("agent_sessions")
    .update({
      status: "running",
      last_tick_at: new Date().toISOString(),
      tick_count: stepNum,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  let iterationsDone = 0;
  let endStatus: TickResult["status"] = "running";
  let pendingApprovalId: string | undefined;
  let errorMessage: string | undefined;
  let didWork = false;
  let willContinue = true;

  try {
    // Lazy-load heavy deps — tools must register before engine/sanitize reads names
    const { executeTool, getToolDefinitions } = await import(
      "@/lib/agent/tools",
    );
    const { runAgentLoop } = await import("@/lib/agent/engine");
    const { buildSystemPrompt, getToolNamesForCapabilities } = await import(
      "@/lib/agent/orchestrator",
    );
    const packs = (session.capability_packs || []) as CapabilityPack[];
    let systemPrompt = buildSystemPrompt({
      capabilities: packs,
      domainInstructions: session.domain_instructions || undefined,
    });
    const missionCtx = await buildLeadGenMissionContextAppendix(
      session.org_id,
      sessionId,
      packs,
    );
    if (missionCtx) systemPrompt = `${systemPrompt}\n\n${missionCtx}`;

    const toolNames = getToolNamesForCapabilities(packs);
    const tools: ToolDefinition[] = getToolDefinitions(toolNames);

    // Resume: load prior history from DB so the LLM sees everything so far.
    // `loadHistory()` already includes all user rows; follow-ups are reinforced
    // via `buildUserFollowUpReinforcement` so the model keeps the latest scope.
    const priorHistoryLoaded = await loadHistory(sessionId);
    const followUpReinforcement =
      await buildUserFollowUpReinforcement(sessionId);
    const continuationBlock = buildContinuationUserMessage(
      priorHistoryLoaded,
      stepNum,
    );
    const priorHistory = [
      ...priorHistoryLoaded,
      ...(continuationBlock ? [continuationBlock] : []),
      ...(followUpReinforcement ? [followUpReinforcement] : []),
    ];
    const userMessage = undefined;

    const context: AgentContext = {
      missionId: session.mission_id ?? sessionId,
      sessionId,
      orgId: session.org_id,
      userId: session.user_id,
      scratchpad: new Map(),
      totalCostCents: session.cost_cents || 0,
      budgetCapCents: session.budget_cap_cents,
      iterationCount: 0,
      maxIterations: iterBudget,
      capabilityPacks: packs,
      inputTokensSoFar: 0,
    };

    if (sessionPacksForBudget.includes("lead-gen-fr")) {
      const nTarget = await fetchLeadTargetForSession(sessionId);
      if (nTarget != null) {
        context.leadGenDiscoveryMinResults = Math.min(
          60,
          Math.max(30, nTarget * 3),
        );
      } else {
        context.leadGenDiscoveryMinResults = 30;
      }
      try {
        const { ensureAgentLeadSearchId } = await import(
          "@/lib/agent/lead-search-stub"
        );
        context.leadSearchId = await ensureAgentLeadSearchId({
          orgId: session.org_id,
          userId: session.user_id,
          sessionId,
          nicheHint: session.domain_instructions,
          locationHint: null,
        });
      } catch (e) {
        console.warn(
          "[agent.tick] ensureAgentLeadSearchId:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    const loopPromise = runAgentLoop(
      {
        systemPrompt,
        tools,
        model: (session.model as AgentModel) || "gemini-2.5-pro",
        maxIterations: iterBudget,
        reflectEveryN,
        reflectionLeadGenDepth: false,
        sessionHints: {
          userFollowUpAppended: Boolean(followUpReinforcement),
        },
        shouldAbort: async () => {
          const { data: row } = await db
            .from("agent_sessions")
            .select("status")
            .eq("id", sessionId)
            .maybeSingle();
          return row?.status === "cancelled";
        },
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
        onReflection: undefined,
        isDeliverableComplete: undefined,
        maxNudgesBeforeYield: 1,
        maxTotalNudges: 2,
        onNudge: async (text, reason) => {
          // Persisted as a hidden system row so the next tick's loadHistory
          // can replay it, without polluting the user-visible chat.
          await db.from("agent_messages").insert({
            session_id: sessionId,
            role: "system",
            content: text,
            metadata: { nudge: true, reason },
          });
        },
        checkOpenWork: undefined,
        finalizeOpenWork: undefined,
        todoSnapshot: undefined,
      },
      context,
      executeTool,
      userMessage,
      priorHistory,
    );

    // Race against soft deadline so we can cleanly hand off
    const timeout = new Promise<"__deadline__">((resolve) =>
      setTimeout(() => resolve("__deadline__"), TICK_SOFT_DEADLINE_MS),
    );
    const raced = await Promise.race([loopPromise, timeout]);

    if (raced === "__deadline__") {
      // The loop is still running in the background; we cannot cleanly abort
      // it, but we'll let it finish writing its last tool call (stateless
      // onMessage/onToolResult just insert rows). The next tick will resume
      // based on DB state.
      endStatus = "yielded";
      iterationsDone = context.iterationCount;
      didWork = iterationsDone > 0;
      willContinue = true;
    } else {
      iterationsDone = raced.iterations;
      didWork = iterationsDone > 0;
      pendingApprovalId = raced.pendingApprovalId;

      if (raced.status === "awaiting_approval") {
        endStatus = "awaiting_approval";
        willContinue = false;
      } else if (raced.status === "awaiting_user_input") {
        endStatus = "paused";
        willContinue = false;
      } else if (raced.status === "budget_exhausted") {
        endStatus = "paused";
        willContinue = false;
      } else if (raced.status === "completed") {
        endStatus = "completed";
        willContinue = false;
      } else if (raced.status === "max_iterations") {
        // Hit per-tick iteration cap; more work likely left — chain another tick.
        endStatus = "yielded";
        willContinue = true;
      } else if (raced.status === "aborted") {
        endStatus = "cancelled";
        willContinue = false;
      }
    }

    const { data: latestRow } = await db
      .from("agent_sessions")
      .select("status")
      .eq("id", sessionId)
      .maybeSingle();
    if (latestRow?.status === "cancelled") {
      willContinue = false;
    }

    const derivedStatus =
      latestRow?.status === "cancelled"
        ? "cancelled"
        : endStatus === "cancelled"
          ? "cancelled"
          : endStatus === "yielded"
            ? "running"
            : endStatus === "completed"
              ? "completed"
              : endStatus === "awaiting_approval"
                ? "awaiting_approval"
                : endStatus === "paused"
                  ? "paused"
                  : "running";

    await db
      .from("agent_sessions")
      .update({
        status: derivedStatus,
        cost_cents: Math.round(context.totalCostCents),
        last_tick_at: new Date().toISOString(),
        last_error: null,
        attempt_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    await db
      .from("agent_session_steps")
      .update({
        status: "done",
        output: {
          iterations: iterationsDone,
          status: endStatus,
          pending_approval_id: pendingApprovalId || null,
        },
        duration_ms: Date.now() - startedAt,
        completed_at: new Date().toISOString(),
      })
      .eq("id", stepId);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[agent.tick] error:", errorMessage);

    const attemptCount = (session.attempt_count || 0) + 1;
    const retryable = isLikelyTransient(err) && attemptCount <= MAX_TICK_RETRIES;

    await db
      .from("agent_session_steps")
      .update({
        status: "failed",
        error: errorMessage,
        duration_ms: Date.now() - startedAt,
        completed_at: new Date().toISOString(),
      })
      .eq("id", stepId);

    const { data: rowAfterErr } = await db
      .from("agent_sessions")
      .select("status")
      .eq("id", sessionId)
      .maybeSingle();
    const statusAfterErr =
      rowAfterErr?.status === "cancelled"
        ? "cancelled"
        : retryable
          ? "running"
          : "failed";

    await db
      .from("agent_sessions")
      .update({
        status: statusAfterErr,
        last_error: rowAfterErr?.status === "cancelled" ? null : errorMessage,
        attempt_count: attemptCount,
        next_retry_at:
          rowAfterErr?.status === "cancelled"
            ? null
            : retryable
              ? new Date(Date.now() + Math.min(30_000, 2000 * attemptCount ** 2))
                  .toISOString()
              : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);

    if (rowAfterErr?.status !== "cancelled") {
      await db.from("agent_messages").insert({
        session_id: sessionId,
        role: "error",
        content: retryable
          ? `Tick error (will retry): ${errorMessage}`
          : `Tick error (giving up after ${MAX_TICK_RETRIES} attempts): ${errorMessage}`,
      });
    }

    willContinue =
      rowAfterErr?.status === "cancelled" ? false : retryable;
    endStatus = retryable ? "retrying" : "failed";
  }

  // Chain next tick if the session still has work. Use a small delay when
  // retrying to avoid hammering a flaky dependency.
  if (willContinue) {
    const delayMs =
      endStatus === "retrying"
        ? Math.min(15_000, 2000 * ((session.attempt_count || 0) + 1))
        : 100;
    await scheduleNextTick(sessionId, { delayMs });
  }

  return {
    sessionId,
    status: endStatus,
    didWork,
    willContinue,
    iterations: iterationsDone,
    costCents: 0,
    errorMessage,
  };
}

// -----------------------------------------------------------------------------
// History loader (reconstructs AgentMessage[] from agent_messages rows)
// -----------------------------------------------------------------------------

/**
 * Short user replies after the last assistant message (or after the initial
 * brief when no assistant exists yet) are easy to ignore once the model has
 * committed to a default city. Re-append them as one high-salience user turn
 * at the **end** of the reconstructed history every tick (DB order is truth).
 */
async function buildUserFollowUpReinforcement(
  sessionId: string,
): Promise<AgentMessage | null> {
  const db = getAgentDb();

  const { data: lastAsst } = await db
    .from("agent_messages")
    .select("created_at")
    .eq("session_id", sessionId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: firstUser } = await db
    .from("agent_messages")
    .select("created_at")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstUser?.created_at) return null;

  const lastAsstMs = lastAsst?.created_at
    ? new Date(lastAsst.created_at).getTime()
    : null;
  const firstUserMs = new Date(firstUser.created_at).getTime();

  const cutoffTs =
    lastAsstMs != null && lastAsstMs >= firstUserMs
      ? lastAsst!.created_at
      : firstUser.created_at;

  const { data: followUps } = await db
    .from("agent_messages")
    .select("content")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .gt("created_at", cutoffTs)
    .order("created_at", { ascending: true });

  if (!followUps?.length) return null;

  const text =
    "[Instructions utilisateur après le message initial / après ta dernière réponse — **priorité absolue** (ville, région, périmètre, contraintes, corrections courtes). Cela **remplace** toute hypothèse implicite, y compris une zone par défaut pour « débloquer ».]\n\n" +
    followUps.map((r, i) => `${i + 1}. ${r.content}`).join("\n");

  return { role: "user", parts: [{ type: "text", text }] };
}

async function loadHistory(sessionId: string): Promise<AgentMessage[]> {
  const db = getAgentDb();
  const { data } = await db
    .from("agent_messages")
    .select("role, content, metadata, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(500);

  if (!data || data.length === 0) return [];

  const messages: AgentMessage[] = [];
  for (const row of data) {
    // Rebuild a lightweight history from user/assistant text plus any
    // persisted "nudges" (hidden corrections we injected when the model
    // went off-rails). Tool call/result details are not replayed here —
    // the agent relies on memory_* + todo_read for cross-tick state.
    if (row.role === "user") {
      messages.push({
        role: "user",
        parts: [{ type: "text", text: row.content }],
      });
    } else if (row.role === "assistant") {
      messages.push({
        role: "assistant",
        parts: [{ type: "text", text: row.content }],
      });
    } else if (row.role === "plan") {
      messages.push({
        role: "assistant",
        parts: [
          {
            type: "text",
            text:
              "[Plan de session — exécuter avec les outils, ne pas seulement le redire en prose.]\n" +
              row.content,
          },
        ],
      });
    } else if (row.role === "system") {
      const meta = (row.metadata || {}) as Record<string, unknown>;
      if (meta.nudge === true) {
        messages.push({
          role: "user",
          parts: [{ type: "text", text: row.content }],
        });
      }
      // other system rows (tool traces) are intentionally skipped here
    }
  }
  return messages;
}

// -----------------------------------------------------------------------------
// Wrappers with retry (used by the HTTP route handlers)
// -----------------------------------------------------------------------------

export async function tickSessionWithRetry(
  sessionId: string,
): Promise<TickResult> {
  return withRetry(() => tickSession(sessionId), {
    maxAttempts: 2,
    baseDelayMs: 500,
  });
}

export { sleep };
