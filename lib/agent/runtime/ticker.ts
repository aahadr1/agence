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
import { acquireLock, releaseLock, type SessionLock } from "./lock";
import { withRetry, isLikelyTransient, sleep } from "./retry";
import { scheduleNextTick } from "./schedule";
import { getAgentDb } from "@/lib/agent/tools/_db";
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

async function countLeadsForAgentSession(
  orgId: string,
  sessionId: string,
): Promise<number> {
  const db = getAgentDb();
  const { count, error } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .contains("enrichment_data", { agent_session_id: sessionId });
  if (error) {
    console.warn("[agent.tick] countLeadsForAgentSession:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** Extract N from "30 leads", "liste de 20 professionnels", etc. */
function parseLeadTargetFromUserPrompt(prompt: string): number | null {
  const p = prompt.trim();
  const m1 = p.match(
    /\b(\d{1,3})\s*(?:leads?|prospects?|professionnels?|lignes?|candidats?)\b/i,
  );
  if (m1) return Math.min(500, Math.max(1, parseInt(m1[1], 10)));
  const m2 = p.match(
    /\b(?:liste|tableau)\s+(?:de|d['']|d')\s*(\d{1,3})\b/i,
  );
  if (m2) return Math.min(500, Math.max(1, parseInt(m2[1], 10)));
  return null;
}

/** French one-liner for nudges: explicit saved vs target (CRM rows only). */
async function leadGenProgressSummaryFr(
  orgId: string,
  sessionId: string,
  userPrompt: string,
): Promise<string> {
  const saved = await countLeadsForAgentSession(orgId, sessionId);
  const target = parseLeadTargetFromUserPrompt(userPrompt);
  if (target != null) {
    const miss = Math.max(0, target - saved);
    return (
      `**Livrable CRM** : ${saved} / ${target} leads sauvegardés (il en manque ${miss}). ` +
      "Seules les lignes créées via save_lead ou batch_save_leads comptent."
    );
  }
  return (
    `**Livrable CRM** : ${saved} lead(s) sauvegardé(s). ` +
    `Sans nombre explicite dans le message initial, vise au moins **1** lead vérifiable, ou demande une clarification.`
  );
}

async function leadGenDeliverableStillIncomplete(
  orgId: string,
  sessionId: string,
  userPrompt: string,
): Promise<boolean> {
  const saved = await countLeadsForAgentSession(orgId, sessionId);
  const target = parseLeadTargetFromUserPrompt(userPrompt);
  if (target != null) return saved < target;
  return saved < 1;
}

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
 * awaiting_approval), returns quickly without doing work.
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
    return await runOneTickLocked(sessionId, lock);
  } finally {
    await releaseLock(lock);
  }
}

// -----------------------------------------------------------------------------
// Internal: one locked tick
// -----------------------------------------------------------------------------

async function runOneTickLocked(
  sessionId: string,
  _lock: SessionLock,
): Promise<TickResult> {
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

  // Terminal states: don't touch.
  if (
    ["completed", "failed", "cancelled", "awaiting_approval"].includes(
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
  /** Lead-gen: reflect more often so forced JSON reflection realigns todos vs evidence. */
  const reflectEveryN = sessionPacksForBudget.includes("lead-gen-fr") ? 4 : 5;

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
    // Lazy-load heavy deps
    const { runAgentLoop } = await import("@/lib/agent/engine");
    const { buildSystemPrompt, getToolNamesForCapabilities } = await import(
      "@/lib/agent/orchestrator"
    );
    const { executeTool, getToolDefinitions } = await import(
      "@/lib/agent/tools"
    );
    const { registerCustomToolsForOrg } = await import(
      "@/lib/agent/runtime/custom-tools"
    );
    const { injectLearnings } = await import(
      "@/lib/agent/runtime/learnings"
    );

    // Load any custom (user-defined, approved) tools for this org
    const customToolNames = await registerCustomToolsForOrg(session.org_id);

    const packs = (session.capability_packs || []) as CapabilityPack[];
    const baseSystem = buildSystemPrompt({
      capabilities: packs,
      domainInstructions: session.domain_instructions || undefined,
    });
    const systemPrompt = await injectLearnings(baseSystem, {
      orgId: session.org_id,
      scopes: packs,
    });

    const toolNames = [
      ...getToolNamesForCapabilities(packs),
      ...customToolNames,
      // Always expose the meta-tools for self-improvement / self-extension
      "learn_record",
      "learn_recall",
      "tool_create",
      "tool_list_custom",
    ];
    const tools: ToolDefinition[] = getToolDefinitions(toolNames);

    // Resume: load prior history from DB so the LLM sees everything so far.
    // Do NOT pass fetchInitialPrompt again on tick 1 — it duplicates the first
    // user row already returned by loadHistory() and can push later user
    // replies ("nancy") away from the model's working focus.
    const priorHistoryLoaded = await loadHistory(sessionId);
    const followUpReinforcement =
      await buildUserFollowUpReinforcement(sessionId);
    const priorHistory = followUpReinforcement
      ? [...priorHistoryLoaded, followUpReinforcement]
      : priorHistoryLoaded;
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
      maxIterations: ITER_PER_TICK,
      capabilityPacks: packs,
      inputTokensSoFar: 0,
    };

    const loopPromise = runAgentLoop(
      {
        systemPrompt,
        tools,
        model: (session.model as AgentModel) || "gemini-2.5-pro",
        maxIterations: iterBudget,
        reflectEveryN,
        reflectionLeadGenDepth: sessionPacksForBudget.includes("lead-gen-fr"),
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
          const rev = r.strategyRevision?.trim();
          const next =
            rev && !/^null$/i.test(rev)
              ? `${r.nextAction || ""}\n\n[Strategy revision]\n${rev}`.slice(0, 8000)
              : r.nextAction;
          await db.from("agent_reflections").insert({
            session_id: sessionId,
            iteration: r.iteration,
            observation: r.observation,
            conclusion: r.conclusion,
            next_action: next ?? null,
          });
        },
        isDeliverableComplete: sessionPacksForBudget.includes("lead-gen-fr")
          ? async () => {
              const saved = await countLeadsForAgentSession(
                session.org_id,
                sessionId,
              );
              const prompt = await fetchInitialPrompt(sessionId);
              const target = parseLeadTargetFromUserPrompt(prompt);
              if (target != null) {
                return saved >= target;
              }
              return saved >= 1;
            }
          : undefined,
        maxNudgesBeforeYield: sessionPacksForBudget.includes("lead-gen-fr")
          ? 5
          : undefined,
        maxTotalNudges: sessionPacksForBudget.includes("lead-gen-fr")
          ? 10
          : undefined,
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
        checkOpenWork: async () => {
          const leadGen = sessionPacksForBudget.includes("lead-gen-fr");
          const userPrompt = leadGen
            ? (await fetchInitialPrompt(sessionId)) || ""
            : "";
          const progressFr =
            leadGen && userPrompt.trim()
              ? await leadGenProgressSummaryFr(
                  session.org_id,
                  sessionId,
                  userPrompt,
                )
              : "";

          const { data: todos } = await db
            .from("agent_todos")
            .select("content, status")
            .eq("session_id", sessionId)
            .in("status", ["pending", "in_progress"])
            .limit(20);
          if (todos && todos.length > 0) {
            const preview = todos
              .slice(0, 5)
              .map((t) => `• ${t.content} (${t.status})`)
              .join("\n");
            const more =
              todos.length > 5 ? `\n…and ${todos.length - 5} more` : "";
            return {
              open: true,
              summary:
                `${todos.length} todo(s) still open:\n${preview}${more}` +
                (progressFr ? `\n\n${progressFr}` : ""),
            };
          }
          // Lead-gen (and similar multi-step packs): never treat "no rows" as
          // "nothing to do" — the model often chats a roadmap then stops before
          // todo_write, so checkOpenWork must still signal open work.
          if (leadGen) {
            const { count, error } = await db
              .from("agent_todos")
              .select("id", { count: "exact", head: true })
              .eq("session_id", sessionId);
            if (!error && (count ?? 0) === 0) {
              return {
                open: true,
                summary:
                  "Aucune liste de todos — appelle `todo_write` puis les outils (`web_search`, `google_maps_search`, …). Ne termine pas sur un plan en prose seul." +
                  (progressFr ? `\n\n${progressFr}` : ""),
              };
            }
            // Todos can show "all completed" while CRM rows are still short of
            // the user's N — keep the session "open" until save_lead catches up.
            if (
              userPrompt.trim() &&
              (await leadGenDeliverableStillIncomplete(
                session.org_id,
                sessionId,
                userPrompt,
              ))
            ) {
              return {
                open: true,
                summary:
                  (progressFr || "**Livrable CRM** : objectif non atteint.") +
                  "\n\nLes todos peuvent être cochés, mais la mission n’est **pas** terminée tant que le nombre de leads **sauvegardés en base** ne suit pas. Enchaîne `save_lead` / `batch_save_leads` (ou explique explicitement en français pourquoi tu ne peux pas, avec le **chiffre réel** sauvegardé).",
              };
            }
          }
          return { open: false };
        },
        finalizeOpenWork: async () => {
          // Auto-close any leftover pending/in_progress todos after a final
          // summary has already been delivered. This is the engine's
          // graceful escape hatch for the post-delivery nudge spiral.
          const { data } = await db
            .from("agent_todos")
            .update({
              status: "completed",
              updated_at: new Date().toISOString(),
            })
            .eq("session_id", sessionId)
            .in("status", ["pending", "in_progress"])
            .select("id, content");
          const n = data?.length || 0;
          if (n === 0) return null;
          return `${n} leftover todo(s) auto-closed`;
        },
        todoSnapshot: async () => {
          // Compact snapshot used both by the forced reflection and the
          // periodic "todo hygiene" reminder. Only returns a string when
          // there's at least one todo — empty string means "skip".
          const { data: rows } = await db
            .from("agent_todos")
            .select("content, status, position")
            .eq("session_id", sessionId)
            .order("position", { ascending: true })
            .limit(30);
          if (!rows || rows.length === 0) return "";
          const lines = rows.map((t, i) => {
            const mark =
              t.status === "completed"
                ? "✓"
                : t.status === "in_progress"
                  ? "►"
                  : t.status === "cancelled"
                    ? "✗"
                    : "·";
            const idx = i + 1;
            const content =
              t.content.length > 100
                ? t.content.slice(0, 97) + "…"
                : t.content;
            return `${idx}. ${mark} [${t.status}] ${content}`;
          });
          return lines.join("\n");
        },
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

async function fetchInitialPrompt(sessionId: string): Promise<string> {
  const db = getAgentDb();
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
