/**
 * Agent V3 engine.
 *
 * ReAct-style loop with:
 *  - provider-neutral messages (Claude or Gemini)
 *  - periodic self-reflection (every N iterations or after consecutive errors)
 *  - approval-driven pause/resume (request_approval tool)
 *  - context compaction when history grows too large
 *  - structured todos / plans / memory surfaced as dedicated tool calls
 *
 * The engine does NOT directly read/write Supabase. It emits events through
 * callbacks (onMessage, onToolResult, onReflection, onApprovalRequest) so the
 * caller (Inngest session runner) decides persistence + realtime broadcast.
 */

import { callLLM, type AgentMessage, type AgentMessagePart } from "@/lib/ai/llm-router";
import type {
  AgentConfig,
  AgentContext,
  AgentReflection,
  ToolDefinition,
  ToolResult,
} from "./types";

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  context: AgentContext,
) => Promise<ToolResult>;

export interface RunAgentResult {
  finalMessage: string;
  history: AgentMessage[];
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterations: number;
  toolCalls: ToolResult[];
  status: "completed" | "awaiting_approval" | "budget_exhausted" | "max_iterations";
  pendingApprovalId?: string;
}

const BUDGET_WARNING_THRESHOLD = 0.85;
const MAX_HISTORY_CHARS = 180_000; // ~60% of Gemini 1M context, tighter for safety
const REFLECT_AFTER_ERRORS = 2;

interface AgentState {
  history: AgentMessage[];
  consecutiveErrors: number;
  lastReflectionIter: number;
  /** Nudges fired since the last successful tool call. Resets on any tool
   *  result with `error === undefined`. Used as a circuit-breaker to avoid
   *  looping forever when the model can't self-correct. */
  nudgesSinceToolSuccess: number;
  /** True once the model has produced a long, structured final-summary-style
   *  message. Used to suppress post-delivery nudge spirals (the "I remain at
   *  your disposal" / "mission accomplished" ping-pong observed in prod). */
  finalSummaryDelivered: boolean;
  /** How many times we've nudged specifically for "open work remaining". If
   *  we've already delivered a final summary and the todos are still open,
   *  second nudge auto-finalizes them instead of looping again. */
  openWorkNudgeCount: number;
  /** Global nudge budget for the whole tick — protects against pathological
   *  loops even when a tool call resets the per-stage counter. */
  totalNudges: number;
  /** Successful tool calls since the agent last touched its todo list via
   *  todo_write / todo_update / todo_update_batch / todo_finalize. Used to
   *  fire a periodic "remember to update your todos" reminder — Gemini in
   *  particular tends to forget after long tool runs. */
  successesSinceTodoTouch: number;
}

const TODO_REMINDER_AFTER_SUCCESSES = 5;
const TODO_TOUCH_TOOLS = new Set<string>([
  "todo_write",
  "todo_update",
  "todo_update_batch",
  "todo_finalize",
]);

const MAX_NUDGES_BEFORE_YIELD = 3;
/** Hard cap on nudges per tick. Once reached we accept the model's message
 *  as final, regardless of other heuristics. */
const MAX_TOTAL_NUDGES = 6;

export async function runAgentLoop(
  config: AgentConfig,
  context: AgentContext,
  executeTool: ToolExecutor,
  userMessage?: string,
  /** Optional: pre-existing history (used when resuming after approval) */
  priorHistory: AgentMessage[] = [],
): Promise<RunAgentResult> {
  // Seed `finalSummaryDelivered` from prior history. When a tick hits
  // max_iterations after a final answer has already been produced, the
  // next tick must NOT treat the session as fresh — otherwise an
  // open_work nudge will fire and the model typically interprets it as
  // "start over" (literal "Bonjour ! J'ai bien compris votre demande …"
  // restart loop we saw in the Nancy lead-gen incident).
  const priorFinalSummary = priorHistoryHasFinalSummary(priorHistory);

  const state: AgentState = {
    history: [...priorHistory],
    consecutiveErrors: 0,
    lastReflectionIter: 0,
    nudgesSinceToolSuccess: 0,
    finalSummaryDelivered: priorFinalSummary,
    openWorkNudgeCount: 0,
    totalNudges: 0,
    successesSinceTodoTouch: 0,
  };

  const allToolCalls: ToolResult[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalMessage = "";

  if (userMessage) {
    state.history.push({
      role: "user",
      parts: [{ type: "text", text: userMessage }],
    });
  }

  const reflectEveryN = config.reflectEveryN ?? 5;

  for (let i = 0; i < config.maxIterations; i++) {
    context.iterationCount = i + 1;

    // ---- Budget guard ----
    if (
      context.budgetCapCents &&
      context.totalCostCents >= context.budgetCapCents
    ) {
      finalMessage = "Budget cap reached. Stopping agent loop.";
      // Don't surface internal terminator as an assistant message — the
      // ticker already journals the outcome and updates session status.
      return buildResult(finalMessage, "budget_exhausted");
    }

    if (
      context.budgetCapCents &&
      context.totalCostCents >=
        context.budgetCapCents * BUDGET_WARNING_THRESHOLD
    ) {
      await config.onMessage?.(
        `Budget warning: ${context.totalCostCents}/${context.budgetCapCents} cents used.`,
      );
    }

    // ---- Context compaction ----
    await maybeCompact(state, config);

    // ---- Optional forced reflection step ----
    const shouldReflect =
      reflectEveryN > 0 &&
      i > 0 &&
      (i - state.lastReflectionIter) >= reflectEveryN;
    const errorReflect = state.consecutiveErrors >= REFLECT_AFTER_ERRORS;
    if (shouldReflect || errorReflect) {
      await runForcedReflection(state, config, context, errorReflect);
      state.lastReflectionIter = i;
      state.consecutiveErrors = 0;
    }

    // ---- LLM call ----
    const result = await callLLM({
      model: config.model,
      systemPrompt: config.systemPrompt,
      history: state.history,
      tools: config.tools,
    });

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    context.totalCostCents += result.costCents;
    context.inputTokensSoFar = totalInputTokens;

    if (result.thinking) {
      await config.onThinking?.(result.thinking);
    }

    // Commit assistant turn to history (preserves thinking + tool_use blocks)
    if (result.assistantParts.length > 0) {
      state.history.push({ role: "assistant", parts: result.assistantParts });
    }

    // Stream visible text to the user
    if (result.text) {
      await config.onMessage?.(result.text);
    }

    // ---- No tool calls → decide: genuine done OR model-emitted pseudo-code ----
    if (result.functionCalls.length === 0) {
      // Update "final delivery" flag once the model has produced a long,
      // structured final-summary-style message. This is sticky: once true it
      // stays true for the rest of the tick and suppresses post-delivery
      // nudge spirals.
      const thisTurnIsFinalSummary = looksLikeFinalSummary(result.text);
      if (thisTurnIsFinalSummary) state.finalSummaryDelivered = true;

      // Circuit breaker: after N nudges with no successful tool call in between,
      // accept the model's message as final. Avoids infinite loops when the
      // model cannot self-correct (e.g. unrecoverable tool-arg format issue).
      const canStillNudge =
        state.nudgesSinceToolSuccess < MAX_NUDGES_BEFORE_YIELD &&
        state.totalNudges < MAX_TOTAL_NUDGES;

      const pseudo = canStillNudge ? detectPseudoToolCall(result.text) : null;
      if (pseudo) {
        const nudge =
          `You just emitted a tool reference as text ("${pseudo}") instead of actually invoking a tool.` +
          ` That text does NOT execute anything.` +
          ` Re-do this turn: call the tool you intended via the function-calling API.` +
          ` Do NOT wrap tool calls in code fences or <tool_code> blocks.`;
        pushNudge(state, nudge);
        await config.onNudge?.(nudge, "pseudo_tool_call");
        state.consecutiveErrors++;
        continue;
      }

      // Intent-without-action: the model described a next step but didn't
      // invoke anything. DO NOT fire this nudge if:
      //   - the model just signed off politely after a completed task
      //   - OR we've already delivered a final summary earlier in this tick
      //     (in that case the sign-off IS the whole point).
      if (
        canStillNudge &&
        !state.finalSummaryDelivered &&
        !looksLikeSignOff(result.text) &&
        looksLikeIntentWithoutAction(result.text)
      ) {
        const nudge =
          "You described the next step but did not call any tool. Execute it now by invoking the appropriate tool. If you truly have nothing left to do, call `todo_finalize` and then write a single short final summary — do not keep announcing actions.";
        pushNudge(state, nudge);
        await config.onNudge?.(nudge, "intent_without_action");
        state.consecutiveErrors++;
        continue;
      }

      // Open-work handling. Two very different cases:
      //   A. This turn IS a final summary OR a polite sign-off OR we've
      //      already delivered a final summary earlier. In that case the
      //      agent is done — we just need to tidy up leftover todos so the
      //      UI doesn't show "1/5" on a session that's actually finished.
      //      We silently auto-finalize via the caller-supplied hook.
      //   B. This turn is NOT a final summary. Then open work really means
      //      the model dropped the ball — nudge it to continue (subject to
      //      the nudge budget).
      const signingOff =
        thisTurnIsFinalSummary ||
        state.finalSummaryDelivered ||
        looksLikeSignOff(result.text);

      if (config.checkOpenWork) {
        try {
          const check = await config.checkOpenWork();
          if (check.open) {
            if (signingOff && config.finalizeOpenWork) {
              // Tidy up: the user's deliverable is in hand, close leftover
              // todos so the session ends cleanly. No nudge, no loop.
              try {
                const summary = await config.finalizeOpenWork();
                if (summary) {
                  await config.onNudge?.(
                    `Auto-finalized leftover todos: ${summary}`,
                    "auto_finalize",
                  );
                }
              } catch (e) {
                console.warn("[engine] auto-finalize failed:", e);
              }
              finalMessage = result.text || "Done.";
              return buildResult(finalMessage, "completed");
            }

            if (canStillNudge && !signingOff) {
              state.openWorkNudgeCount++;
              // IMPORTANT: the nudge wording matters. Earlier phrasings
              // ("You stopped but there is still open work …") were
              // misinterpreted by Gemini as "redo the whole task", which
              // produced the Nancy-style restart loop. Keep this short,
              // concrete, and NEVER instruct a re-plan.
              const nudge =
                `Open todos remain (${check.summary || "see list"}). ` +
                "Do ONE of these, then continue: (a) call the next tool for the current in-progress todo, (b) call `todo_update` with a 1-based index (\"1\", \"2\", …) to advance status, or (c) call `todo_finalize` if the deliverable is already complete. Do NOT re-greet, re-plan, or call `todo_write` — the plan already exists.";
              pushNudge(state, nudge);
              await config.onNudge?.(nudge, "open_work_remaining");
              state.consecutiveErrors++;
              continue;
            }
          }
        } catch {
          // soft-fail the check; proceed to completion
        }
      }

      finalMessage = result.text || "Done.";
      return buildResult(finalMessage, "completed");
    }

    // ---- Restart-loop guard ----
    // If a final summary was already delivered earlier (in this tick or a
    // previous one carried via priorHistory), and the model is now trying to
    // "start over" with a fresh greeting + a wipe-and-rewrite of the todo
    // list (todo_write deletes all existing todos), we treat that as a
    // stuck-in-a-loop signal. The right move is to finalize and stop — NOT
    // to let the model re-run the whole task against a fresh todo list.
    //
    // Concrete trigger we saw (Nancy lead-gen incident): after delivering
    // "Voici la liste des 10 leads …", the next tick picked up, nudged
    // "open work remaining", and Gemini responded with "Bonjour ! J'ai
    // bien compris votre demande. Je vais rechercher …" followed by a
    // fresh todo_write. Four full restart cycles ensued.
    if (
      state.finalSummaryDelivered &&
      looksLikeRestart(result.text, result.functionCalls)
    ) {
      if (config.finalizeOpenWork) {
        try {
          const summary = await config.finalizeOpenWork();
          if (summary) {
            await config.onNudge?.(
              `Auto-finalized leftover todos: ${summary}`,
              "restart_loop_detected",
            );
          }
        } catch (e) {
          console.warn("[engine] auto-finalize on restart failed:", e);
        }
      }
      // Use the last known final text from history, not the restart greeting.
      const priorFinal = lastFinalSummaryText(state.history) || "Done.";
      return buildResult(priorFinal, "completed");
    }

    // ---- Execute tool calls ----
    const toolResultParts: AgentMessagePart[] = [];
    let approvalRequestId: string | undefined;

    for (const fc of result.functionCalls) {
      await config.onToolCall?.(fc.name, fc.args);
      const toolResult = await executeTool(fc.name, fc.args, context);
      allToolCalls.push(toolResult);
      context.totalCostCents += toolResult.costCents;
      await config.onToolResult?.(toolResult);

      // Update error streak
      if (toolResult.error) {
        state.consecutiveErrors++;
      } else {
        state.consecutiveErrors = 0;
        // A successful tool call clears the nudge budget so future
        // corrections remain available.
        state.nudgesSinceToolSuccess = 0;
        // Track todo-hygiene: any touch of the todo list resets the
        // reminder counter; other successes increment it.
        if (TODO_TOUCH_TOOLS.has(fc.name)) {
          state.successesSinceTodoTouch = 0;
        } else {
          state.successesSinceTodoTouch++;
        }
      }

      // Special handling: request_approval pauses the loop
      if (fc.name === "request_approval" && !toolResult.error) {
        const r = toolResult.result as
          | { approval_id?: string; status?: string }
          | null;
        if (r?.approval_id && r.status === "awaiting") {
          approvalRequestId = r.approval_id;
        }
      }

      // Serialize tool result for the model
      const content =
        toolResult.error ?? safeStringify(toolResult.result ?? null);

      toolResultParts.push({
        type: "tool_result",
        toolUseId: fc.id,
        content,
        isError: !!toolResult.error,
      });
    }

    state.history.push({ role: "user", parts: toolResultParts });

    // Todo-hygiene reminder: if the agent has been running non-todo tools
    // for a while, append a short todo-state snapshot to the last tool
    // result so it re-enters working memory. This fixes the Nancy bug where
    // Gemini delivered the final list but never advanced the todo list
    // past position 2/5.
    if (
      state.successesSinceTodoTouch >= TODO_REMINDER_AFTER_SUCCESSES &&
      config.todoSnapshot
    ) {
      try {
        const snapshot = await config.todoSnapshot();
        if (snapshot && snapshot.trim().length > 0) {
          state.history.push({
            role: "user",
            parts: [
              {
                type: "text",
                text:
                  "[todo hygiene reminder — reply only if action is needed]\n" +
                  snapshot +
                  "\nIf any of the open todos above are already done, close them with `todo_update_batch` in your next turn (before starting new work). If the next phase has begun, mark the new current todo `in_progress`.",
              },
            ],
          });
          state.successesSinceTodoTouch = 0;
        }
      } catch {
        // soft-fail — reminders are best-effort
      }
    }

    // Pause if approval requested
    if (approvalRequestId) {
      return {
        finalMessage: "Awaiting user approval.",
        history: state.history,
        totalCostCents: context.totalCostCents,
        totalInputTokens,
        totalOutputTokens,
        iterations: context.iterationCount,
        toolCalls: allToolCalls,
        status: "awaiting_approval",
        pendingApprovalId: approvalRequestId,
      };
    }
  }

  // Max iterations reached — yield to the next tick silently.
  finalMessage =
    finalMessage || "Maximum iterations reached. Stopping agent loop.";
  return buildResult(finalMessage, "max_iterations");

  // -------------------------------------------------------------------------
  function buildResult(
    msg: string,
    status: RunAgentResult["status"],
  ): RunAgentResult {
    return {
      finalMessage: msg,
      history: state.history,
      totalCostCents: context.totalCostCents,
      totalInputTokens,
      totalOutputTokens,
      iterations: context.iterationCount,
      toolCalls: allToolCalls,
      status,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect when the model wrote tool code as *text* instead of actually invoking
 * a tool via the function-calling API. Common Gemini failure mode.
 * Returns a short excerpt on match, null otherwise.
 */
function detectPseudoToolCall(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = text;
  // <tool_code>...</tool_code> blocks
  const m1 = s.match(/<tool_code>[\s\S]{0,200}/i);
  if (m1) return m1[0].slice(0, 80);
  // ```tool_code ... ```
  const m2 = s.match(/```(?:tool_code|python|js|ts|javascript|typescript)?[\s\S]{0,30}?(?:print\s*\(|await\s+)\w+\(/i);
  if (m2) return m2[0].slice(0, 80);
  // Bare `print(toolname(` anywhere — the classic Gemini-emits-python pattern
  const m3 = s.match(/\bprint\s*\(\s*[a-z_][a-z0-9_]*\s*\(/i);
  if (m3) return m3[0].slice(0, 80);
  return null;
}

const INTENT_PATTERNS: RegExp[] = [
  // Announcing an imminent action (strong signal)
  /\bje\s+vais\s+(?:maintenant\s+)?(?:lancer|commencer|chercher|faire|cr[eé]er|appeler|ex[eé]cuter|utiliser|consulter|analyser|continuer|mettre|examiner|passer|v[eé]rifier|essayer|regarder)\b/i,
  /\b(?:let\s+me|i['’]?ll|i\s+will|i\s+am\s+going\s+to)\s+(?:now\s+)?(?:search|call|run|use|execute|invoke|check|analyze|look|find|try|continue|proceed)\b/i,
  /\bon\s+va\s+(?:maintenant\s+)?(?:lancer|commencer|chercher|faire|analyser|essayer|continuer)\b/i,
  /\b(commen[çc](?:e|ons|er)|launching|starting\s+(?:now|by))\b/i,
  /\b(premi[eè]re?\s+[eé]tape|étape\s*1|first\s+step|step\s*1)\b/i,
  // Describing remaining/next work
  /\b(prochaine?\s+(?:action|[eé]tape|chose)|next\s+(?:action|step|move))\b/i,
  /\b(il\s+me\s+(?:reste|manque)\s+\w+|i\s+still\s+need\s+to|still\s+have\s+to)\b/i,
  /\b(je\s+dois\s+(?:maintenant\s+)?|i\s+must\s+now|i\s+should\s+now|il\s+faut\s+que\s+je)\b/i,
  /\b(continu\w+|reprendre|resume|keep\s+going)\b/i,
];

const SIGN_OFF_PATTERNS: RegExp[] = [
  /\bn['’]h[eé]sitez\s+pas\b/i,
  /\bje\s+reste\s+[àa]\s+(?:ta|votre)\s+disposition\b/i,
  /\b[àa]\s+(?:votre|ta)\s+(?:disposition|service)\b/i,
  /\bje\s+suis\s+(?:maintenant\s+)?(?:pr[eê]t|disponible)\b/i,
  /\b(?:si\s+vous\s+avez|for)\s+(?:d['’]autres\s+demandes|any\s+other|other\s+questions)\b/i,
  /\b(?:mission|t[âa]che|task|travail)\s+(?:est\s+)?(?:maintenant\s+)?(?:accomplie|termin[eé]e?|complete(?:d)?|done)\b/i,
  /\b(?:c['’]est\s+)?(?:fini|done|terminé|termin[eé])\b/i,
  /\bfeel\s+free\s+to\b/i,
  /\blet\s+me\s+know\s+if\b/i,
];

/**
 * Detect an "I will do X" style closing where the model describes its next
 * action but never actually calls a tool. We treat this as a mistake (the
 * model should either call the tool or genuinely summarize and stop).
 *
 * NOTE: This intentionally errs on the side of FALSE — a false nudge is
 * highly disruptive (triggers a visible "Auto-correction" UI element).
 * We now require 2+ matching signals and ignore the whole test for messages
 * that also look like polite sign-offs.
 */
function looksLikeIntentWithoutAction(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 20) return false;
  // Skip polite sign-offs — detected separately and explicitly excluded
  // in the engine before this function is called, but double-check anyway.
  if (looksLikeSignOff(t)) return false;
  // Very short "ok done" messages are fine — skip
  if (t.length < 60 && /\b(done|ok|okay|termin[eé]|voilà|vu|parfait)\b/i.test(t)) {
    return false;
  }
  let hits = 0;
  for (const re of INTENT_PATTERNS) {
    if (re.test(t)) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

/**
 * Polite sign-off / "end of task" patterns. When the model closes the
 * session with these we treat the message as final, no matter what.
 */
function looksLikeSignOff(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length === 0) return false;
  for (const re of SIGN_OFF_PATTERNS) {
    if (re.test(t)) return true;
  }
  return false;
}

function pushNudge(state: AgentState, nudge: string) {
  state.history.push({ role: "user", parts: [{ type: "text", text: nudge }] });
  state.nudgesSinceToolSuccess++;
  state.totalNudges++;
}

/**
 * Heuristic: does the text look like a completed, substantial final answer?
 * Used to avoid nudging "open work" when the agent has, in fact, delivered
 * a polished summary (e.g. a list of qualified leads). Criteria:
 *  - long enough (>= 400 chars)
 *  - AND contains at least one "structure" signal: numbered list, bullet
 *    list, markdown heading, or a "final / conclusion / liste" keyword.
 */
function looksLikeFinalSummary(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 400) return false;
  const signals = [
    /(^|\n)\s*\d+\.\s+\S/, // numbered list item
    /(^|\n)\s*[-*]\s+\S/, // bullet list item
    /(^|\n)#{1,3}\s+\S/, // markdown heading
    /\b(liste\s+finale|final\s+list|synth[eè]se|en\s+résum[eé]|conclusion)\b/i,
  ];
  return signals.some((re) => re.test(t));
}

/**
 * Scan a bounded tail of the priorHistory to seed `finalSummaryDelivered`
 * at tick start. Prevents the cross-tick restart loop where the next tick
 * woke up fresh, saw a stale "open todos" nudge, and re-greeted the user
 * ("Bonjour ! J'ai bien compris votre demande …") instead of closing out.
 *
 * We look at the last ~8 assistant text messages — enough to catch recent
 * work without paying for a full scan of a long history.
 */
function priorHistoryHasFinalSummary(history: AgentMessage[]): boolean {
  if (history.length === 0) return false;
  let scanned = 0;
  for (let i = history.length - 1; i >= 0 && scanned < 8; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => ("text" in p ? p.text : ""))
      .join("\n");
    if (text.trim()) {
      scanned++;
      if (looksLikeFinalSummary(text)) return true;
    }
  }
  return false;
}

/**
 * Return the text of the most recent assistant message that looks like a
 * final summary, or null if none. Used when we short-circuit a restart
 * loop so the user sees the last good answer rather than the greeting
 * that triggered the abort.
 */
function lastFinalSummaryText(history: AgentMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role !== "assistant") continue;
    const text = msg.parts
      .filter((p) => p.type === "text")
      .map((p) => ("text" in p ? p.text : ""))
      .join("\n");
    if (looksLikeFinalSummary(text)) return text;
  }
  return null;
}

const RESTART_GREETING_RE =
  /^(?:\s*)(?:bonjour|hello|hi|salut|hey)\s*[!.,\s]+/i;
const RESTART_INTENT_PATTERNS = [
  /j'?ai\s+(bien\s+)?compris\s+(votre\s+demande|la\s+mission)/i,
  /i\s+understand\s+(your\s+request|the\s+mission)/i,
  /c'?est\s+une\s+mission\s+(très\s+)?claire/i,
  /voici\s+mon\s+plan\s+d'?action/i,
  /here'?s\s+my\s+plan/i,
  /je\s+vais\s+(vous\s+)?(trouver|rechercher|constituer|me\s+mettre)/i,
];

/**
 * Detects a "restart" turn: the model is greeting + re-planning + about to
 * wipe the todo list, after it has already delivered a final answer. This
 * is the Nancy-style loop ("Bonjour ! Voici mon plan …" × 4).
 *
 * Conservative: we require BOTH a greeting OR a plan-intent phrase AND a
 * todo_write tool call, so we never misfire on the legitimate first turn
 * of a brand new task.
 */
function looksLikeRestart(
  text: string | null | undefined,
  calls: ReadonlyArray<{ name: string }>,
): boolean {
  const hasTodoWrite = calls.some((c) => c.name === "todo_write");
  if (!hasTodoWrite) return false;
  if (!text) return false;
  const t = text.trim();
  if (t.length < 20) return false;
  if (RESTART_GREETING_RE.test(t)) return true;
  return RESTART_INTENT_PATTERNS.some((re) => re.test(t));
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const s = JSON.stringify(value);
    return s.length > 8000 ? s.slice(0, 8000) + "...(truncated)" : s;
  } catch {
    return String(value);
  }
}

/**
 * Rough size estimate of the history in characters. If we blow past the
 * threshold, we summarize everything older than the last 8 turns into a
 * single system message.
 */
async function maybeCompact(state: AgentState, config: AgentConfig) {
  const approxChars = state.history.reduce((sum, m) => {
    for (const p of m.parts) {
      if (p.type === "text") sum += p.text.length;
      else if (p.type === "thinking") sum += p.thinking.length;
      else if (p.type === "tool_result") sum += p.content.length;
      else if (p.type === "tool_use") sum += JSON.stringify(p.input).length;
    }
    return sum;
  }, 0);

  const threshold =
    (config.compactionThreshold ?? 0.6) * MAX_HISTORY_CHARS;
  if (approxChars < threshold) return;
  if (state.history.length < 12) return;

  const keep = state.history.slice(-8);
  const older = state.history.slice(0, -8);
  const summaryText = summarizeMessages(older);

  state.history = [
    {
      role: "user",
      parts: [
        {
          type: "text",
          text:
            `[Earlier conversation compacted to save context.]\n\n` +
            `Summary of ${older.length} earlier messages:\n${summaryText}`,
        },
      ],
    },
    ...keep,
  ];
}

function summarizeMessages(messages: AgentMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === "text") {
        const trimmed = p.text.trim();
        if (trimmed) lines.push(`${m.role}: ${trimmed.slice(0, 300)}`);
      } else if (p.type === "tool_use") {
        lines.push(`called ${p.name}(${JSON.stringify(p.input).slice(0, 200)})`);
      } else if (p.type === "tool_result") {
        const snippet = p.content.slice(0, 200);
        lines.push(`→ ${snippet}${p.isError ? " [error]" : ""}`);
      }
    }
  }
  return lines.join("\n");
}

/**
 * Insert a "please reflect" nudge into history, then consume one turn of the
 * LLM without any tool calls (tools are excluded so the model is forced to
 * produce a reflection).
 *
 * IMPORTANT: the reflection output is NOT surfaced to the user as a chat
 * message — it's delivered via the structured `onReflection` callback only.
 * Otherwise we end up with noisy "OBSERVATION / CONCLUSION / NEXT ACTION"
 * blocks polluting the conversation (the exact bug observed in the Nancy
 * lead-gen session).
 */
async function runForcedReflection(
  state: AgentState,
  config: AgentConfig,
  context: AgentContext,
  dueToError: boolean,
) {
  // Optional todo snapshot so the reflection is grounded in actual state.
  let todoBlock = "";
  if (config.todoSnapshot) {
    try {
      const snap = await config.todoSnapshot();
      if (snap && snap.trim().length > 0) {
        todoBlock = `\n\nCurrent todos:\n${snap}`;
      }
    } catch {
      /* best-effort */
    }
  }

  const leadGenDepthBlock =
    config.reflectionLeadGenDepth
      ? " LEAD-GEN DEPTH: Inside the JSON strings, briefly cover (a) legal-entity vs Maps address / cessée / homonym risk for work in flight, (b) whether any 'no website' claim still holds vs Maps website_url, (c) quality vs filling N weak rows. Each field may use up to 4 short sentences."
      : "";

  const nudge = dueToError
    ? [
        "You hit repeated tool errors. Pause and reflect (for yourself only, NOT as a user-facing message).",
        "Respond with a single JSON object — no prose outside the JSON, no code fences — shaped exactly as:",
        `{"observation": "...", "conclusion": "...", "next_action": "..."}`,
        "Keep each field under 2 short sentences. Include in `next_action` which todo you should mark completed/in_progress, if any." +
          leadGenDepthBlock +
          todoBlock,
      ].join(" ")
    : [
        "Pause and reflect internally (not shown to the user).",
        "Respond with a single JSON object — no prose outside the JSON, no code fences — shaped exactly as:",
        `{"observation": "...", "conclusion": "...", "next_action": "..."}`,
        "Keep each field under 2 short sentences. Include in `next_action` which todo you should mark completed/in_progress, if any." +
          leadGenDepthBlock +
          todoBlock,
      ].join(" ");

  state.history.push({
    role: "user",
    parts: [{ type: "text", text: nudge }],
  });

  const result = await callLLM({
    model: config.model,
    systemPrompt: config.systemPrompt,
    history: state.history,
    tools: [], // no tool use during reflection
  });

  context.totalCostCents += result.costCents;
  if (result.assistantParts.length > 0) {
    state.history.push({ role: "assistant", parts: result.assistantParts });
  }

  // Parse structured reflection fields; fall back gracefully when the model
  // replied in prose instead of JSON.
  const parsed = parseReflection(result.text);
  const reflection: AgentReflection = {
    iteration: context.iterationCount,
    observation: parsed.observation || (result.thinking || "").slice(0, 2000),
    conclusion: parsed.conclusion || (result.text || "").slice(0, 2000),
    nextAction: parsed.nextAction,
  };
  await config.onReflection?.(reflection);
}

function parseReflection(
  text: string | null | undefined,
): { observation: string; conclusion: string; nextAction: string } {
  if (!text) return { observation: "", conclusion: "", nextAction: "" };
  // Strip common code-fence wrapping
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  // Try strict JSON first
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      observation: String(obj.observation ?? obj.Observation ?? "").slice(0, 2000),
      conclusion: String(obj.conclusion ?? obj.Conclusion ?? "").slice(0, 2000),
      nextAction: String(
        obj.next_action ?? obj.nextAction ?? obj.NextAction ?? "",
      ).slice(0, 1000),
    };
  } catch {
    /* fall through to heuristic parse */
  }
  // Heuristic: pull OBSERVATION / CONCLUSION / ACTION sections the model used
  // to emit organically.
  const pick = (label: RegExp): string => {
    const m = cleaned.match(label);
    return m ? m[1].trim().slice(0, 2000) : "";
  };
  const observation = pick(
    /observation[\s:\-]+([\s\S]*?)(?=\n\s*(?:conclusion|action|next)|$)/i,
  );
  const conclusion = pick(
    /conclusion[\s:\-]+([\s\S]*?)(?=\n\s*(?:action|next)|$)/i,
  );
  const nextAction = pick(
    /(?:next(?:_|\s)?action|action\s+suivante)[\s:\-]+([\s\S]*?)$/i,
  );
  return { observation, conclusion, nextAction: nextAction.slice(0, 1000) };
}

export function toolsFromRegistry(
  names: string[],
  getDef: (name: string) => ToolDefinition | undefined,
): ToolDefinition[] {
  return names.map((n) => getDef(n)).filter(Boolean) as ToolDefinition[];
}
