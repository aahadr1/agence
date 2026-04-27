/**
 * Agent V3 engine.
 *
 * ReAct-style loop with:
 *  - provider-neutral messages (Claude or Gemini)
 *  - periodic self-reflection (every N iterations or after consecutive errors)
 *  - approval-driven pause/resume (request_approval tool)
 *  - clarification pause (ask_user tool — same tick stops until user replies)
 *  - context compaction when history grows too large
 *  - structured todos / plans / memory surfaced as dedicated tool calls
 *
 * The engine does NOT directly read/write Supabase. It emits events through
 * callbacks (onMessage, onToolResult, onReflection, onApprovalRequest) so the
 * caller (Inngest session runner) decides persistence + realtime broadcast.
 */

import { callLLM, type AgentMessage, type AgentMessagePart } from "@/lib/ai/llm-router";
import { sanitizeAssistantUserText } from "@/lib/agent/sanitize-user-visible-text";
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
  status:
    | "completed"
    | "awaiting_approval"
    | "awaiting_user_input"
    | "budget_exhausted"
    | "max_iterations"
    | "aborted";
  pendingApprovalId?: string;
}

const BUDGET_WARNING_THRESHOLD = 0.85;
const MAX_HISTORY_CHARS = 180_000; // ~60% of Gemini 1M context, tighter for safety
const REFLECT_AFTER_ERRORS = 2;

interface AgentState {
  history: AgentMessage[];
  consecutiveErrors: number;
  lastReflectionIter: number;
  /** One-shot hint after first successful Maps discovery in this tick */
  discoverySteeringDone: boolean;
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
  /** Successful tool calls since the agent last touched V1 durable work state. */
  successesSinceTodoTouch: number;
  /** Legacy flag kept for state shape compatibility; V1 uses prospect_list. */
  scratchpadMandatePending: boolean;
}

const TODO_REMINDER_AFTER_SUCCESSES = 5;
const TODO_TOUCH_TOOLS = new Set<string>(["prospect_list"]);

const DEFAULT_MAX_NUDGES_BEFORE_YIELD = 3;
/** Hard cap on nudges per tick. Once reached we accept the model's message
 *  as final, regardless of other heuristics. */
const DEFAULT_MAX_TOTAL_NUDGES = 6;

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
    discoverySteeringDone: false,
    nudgesSinceToolSuccess: 0,
    finalSummaryDelivered: priorFinalSummary,
    openWorkNudgeCount: 0,
    totalNudges: 0,
    successesSinceTodoTouch: 0,
    scratchpadMandatePending: false,
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

    if (config.shouldAbort && (await config.shouldAbort())) {
      finalMessage = "Session arrêtée.";
      return buildResult(finalMessage, "aborted");
    }

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
      if (config.shouldAbort && (await config.shouldAbort())) {
        finalMessage = "Session arrêtée.";
        return buildResult(finalMessage, "aborted");
      }
      await runForcedReflection(state, config, context, errorReflect);
      state.lastReflectionIter = i;
      state.consecutiveErrors = 0;
    }

    // ---- LLM call ----
    if (config.shouldAbort && (await config.shouldAbort())) {
      finalMessage = "Session arrêtée.";
      return buildResult(finalMessage, "aborted");
    }
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

    // Stream visible text to the user (strip pseudo-tool line noise)
    if (result.text) {
      const vis = sanitizeAssistantUserText(result.text);
      const displayText = vis.length > 0 ? vis : result.text.trim();
      if (!looksLikeProcessChatterOnly(displayText)) {
        await config.onMessage?.(displayText);
      }
    }

    // ---- No tool calls → decide: genuine done OR model-emitted pseudo-code ----
    if (result.functionCalls.length === 0) {
      // Prose roadmaps ("1. Search … 2. Analyze …" + "I will start…") must NOT
      // count as a final deliverable — otherwise we mark the session done with
      // zero tools (common when checkOpenWork sees no todos yet).
      const planningRoadmap = looksLikePlanningRoadmap(result.text);
      // Update "final delivery" flag once the model has produced a long,
      // structured final-summary-style message. This is sticky: once true it
      // stays true for the rest of the tick and suppresses post-delivery
      // nudge spirals.
      const thisTurnIsFinalSummary =
        !planningRoadmap && looksLikeFinalSummary(result.text);
      if (thisTurnIsFinalSummary) state.finalSummaryDelivered = true;

      // Circuit breaker: after N nudges with no successful tool call in between,
      // accept the model's message as final. Avoids infinite loops when the
      // model cannot self-correct (e.g. unrecoverable tool-arg format issue).
      const maxNudgesBeforeYield = config.maxNudgesBeforeYield ?? DEFAULT_MAX_NUDGES_BEFORE_YIELD;
      const maxTotalNudges = config.maxTotalNudges ?? DEFAULT_MAX_TOTAL_NUDGES;
      const canStillNudge =
        state.nudgesSinceToolSuccess < maxNudgesBeforeYield &&
        state.totalNudges < maxTotalNudges;

      const pseudo = canStillNudge ? detectPseudoToolCall(result.text) : null;
      if (pseudo) {
        const nudge =
          `Tu as écrit « ${pseudo} » comme texte — ça n’exécute rien.` +
          ` Réessaie ce tour en appelant **réellement** l’outil via l’API fonctions.` +
          ` Pas de barres à code ni de pseudo-code pour les outils.`;
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
        (looksLikeIntentWithoutAction(result.text) || planningRoadmap)
      ) {
        const nudge = planningRoadmap
          ? "Tu as publié une roadmap en prose — elle ne fait rien tourner. Crée/actualise d’abord l’état durable avec prospect_list action=task_create ou task_update, puis appelle le prochain outil réel (browser, prospect_discovery, business_research ou prospect_list)."
          : "Tu décris la prochaine étape mais aucun outil n’a été appelé. Lance l’outil réel maintenant. Si tout est vraiment fini, vérifie prospect_list action=status puis livre le résultat final — pas d’annonce sans action.";
        pushNudge(state, nudge);
        await config.onNudge?.(
          nudge,
          planningRoadmap ? "planning_roadmap_no_tools" : "intent_without_action",
        );
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
      const textLooksLikeDone =
        thisTurnIsFinalSummary ||
        state.finalSummaryDelivered ||
        looksLikeSignOff(result.text);

      // CRITICAL: text heuristics alone are not enough to determine "done".
      // If a deliverable-completeness check is configured, use it as a gate:
      // the agent is only truly signing off when both (a) the text looks like
      // a conclusion AND (b) the actual deliverable is present. This prevents
      // premature closure when the agent emits a long reflection or progress
      // message that triggers looksLikeFinalSummary but has produced no output.
      let signingOff = textLooksLikeDone;
      if (signingOff && config.isDeliverableComplete) {
        try {
          const deliverableReady = await config.isDeliverableComplete();
          if (!deliverableReady) {
            // The text LOOKS like a final summary but the actual work product
            // is not ready. Reset the sticky flag and treat this as open work.
            signingOff = false;
            state.finalSummaryDelivered = false;
          }
        } catch {
          // soft-fail: proceed with text-based heuristic
        }
      }

      if (config.checkOpenWork) {
        try {
          const check = await config.checkOpenWork();
          if (check.open) {
            if (signingOff && config.finalizeOpenWork) {
              if (config.isDeliverableComplete) {
                try {
                  const deliverableOk = await config.isDeliverableComplete();
                  if (!deliverableOk) {
                    state.finalSummaryDelivered = false;
                    const nudge =
                      "Ta conclusion ne suffit pas : le livrable réel est encore incomplet. Vérifie prospect_list action=status, mets à jour la tâche en cours, puis continue avec les outils jusqu’au volume demandé ou enregistre un blocker_summary explicite.";
                    pushNudge(state, nudge);
                    await config.onNudge?.(nudge, "deliverable_blocks_auto_finalize");
                    state.consecutiveErrors++;
                    continue;
                  }
                } catch {
                  /* proceed — same as other deliverable soft-fails */
                }
              }
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
              const followUp = config.sessionHints?.userFollowUpAppended;
              const nudge = followUp
                ? [
                    `Travail encore ouvert (${check.summary || ""}). `,
                    "Si l’utilisateur vient de corriger la ville ou le périmètre, mets à jour prospect_list task state puis relance la découverte.",
                    "Sinon : une seule action parmi — (a) prospect_list action=task_update/status, (b) le prochain outil réel, (c) prospect_list blocker_summary si le livrable est impossible honnêtement.",
                    "Ne refais pas une introduction « Bonjour » ni un plan depuis zéro sans que ce soit une nouvelle mission.",
                  ].join(" ")
                : [
                    `Travail encore ouvert (${check.summary || ""}). `,
                    "Une action parmi — (a) prospect_list action=task_update/status, (b) prochain outil réel, (c) prospect_list blocker_summary si tout est bloqué.",
                    "Pas de nouveau Bonjour ni de plan prose sans action.",
                  ].join(" ");
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

      // Never mark "completed" on prose-only turns if the host says the real
      // deliverable (e.g. saved leads vs target) is still missing — even when
      // todos are closed or checkOpenWork returned false.
      if (config.isDeliverableComplete) {
        try {
          const deliverableReady = await config.isDeliverableComplete();
          if (!deliverableReady) {
            const nudge =
              "Ton message ressemble à une conclusion, mais le livrable attendu n’est pas atteint. Vérifie prospect_list action=status, continue le travail, sauvegarde/exporte les lignes vérifiées, ou enregistre un blocker_summary précis si l’objectif est impossible.";
            pushNudge(state, nudge);
            await config.onNudge?.(nudge, "deliverable_incomplete");
            state.finalSummaryDelivered = false;
            state.consecutiveErrors++;
            continue;
          }
        } catch {
          /* soft-fail */
        }
      }

      finalMessage = result.text || "Done.";
      return buildResult(finalMessage, "completed");
    }

    if (config.requiresTaskState && hasSubstantiveWorkCall(result.functionCalls)) {
      let hasTaskState = false;
      try {
        hasTaskState = await config.hasTaskState?.() ?? false;
      } catch {
        hasTaskState = false;
      }
      if (!hasTaskState && !result.functionCalls.some(isV1TaskCreateCall)) {
        const nudge =
          "État de tâches manquant. Avant toute recherche, navigation, enrichissement ou sauvegarde, appelle prospect_list avec action=\"task_create\" et une liste de phases concrètes. Ensuite seulement lance le premier outil de travail.";
        pushNudge(state, nudge);
        await config.onNudge?.(nudge, "missing_task_state");
        state.consecutiveErrors++;
        continue;
      }
    }

    // ---- Restart-loop guard ----
    // If a final summary was already delivered earlier (in this tick or a
    // previous one carried via priorHistory), and the model is now trying to
    // "start over" with a fresh greeting + a fresh V1 task list, we treat that as a
    // stuck-in-a-loop signal. The right move is to finalize and stop — NOT
    // to let the model re-run the whole task against a fresh work state.
    //
    // Concrete trigger we saw (Nancy lead-gen incident): after delivering
    // "Voici la liste des 10 leads …", the next tick picked up, nudged
    // "open work remaining", and Gemini responded with "Bonjour ! J'ai
    // bien compris votre demande. Je vais rechercher …" followed by a
    // fresh prospect_list task_create. Four full restart cycles ensued.
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
    if (config.shouldAbort && (await config.shouldAbort())) {
      finalMessage = "Session arrêtée.";
      return buildResult(finalMessage, "aborted");
    }
    const toolResultParts: AgentMessagePart[] = [];
    let approvalRequestId: string | undefined;

    // Check if any call is request_approval — must execute alone first
    const approvalCall = result.functionCalls.find(
      (fc) => fc.name === "request_approval",
    );
    const askUserCall = result.functionCalls.find(
      (fc) => fc.name === "ask_user",
    );
    const otherCalls = result.functionCalls.filter(
      (fc) => fc.name !== "request_approval" && fc.name !== "ask_user",
    );

    // Helper to process one tool call
    const processToolCall = async (fc: (typeof result.functionCalls)[0]) => {
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
        state.nudgesSinceToolSuccess = 0;
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

      let content =
        toolResult.error ?? safeStringify(toolResult.result ?? null);

      // Append inline recovery guidance for non-retryable errors so the
      // model sees it in-band with the tool result (no separate injection).
      if (toolResult.error?.includes("[NON_RETRYABLE]")) {
        content +=
          "\n\n[AUTO] Erreur non-retryable. Ne retente PAS ce même appel. " +
          "Mets à jour l’état avec `prospect_list` (task_update ou blocker_summary), bascule " +
          "vers un outil alternatif, ou passe au candidat suivant.";
      }

      return {
        type: "tool_result" as const,
        toolUseId: fc.id,
        content,
        isError: !!toolResult.error,
      };
    };

    // Execute request_approval first if present
    if (approvalCall) {
      toolResultParts.push(await processToolCall(approvalCall));
      if (approvalRequestId) {
        // Approval requested — still need to push result parts for the model
        // but skip other tool calls (they'll run after approval).
        state.history.push({ role: "user", parts: toolResultParts });
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

    // ask_user: run alone and end the tick so nudges / follow-up tool calls
    // cannot fabricate an answer before the user replies (Strasbourg incident).
    if (askUserCall) {
      toolResultParts.push(await processToolCall(askUserCall));
      const askTr = allToolCalls[allToolCalls.length - 1];
      if (!askTr?.error) {
        state.history.push({ role: "user", parts: toolResultParts });
        return buildResult(
          "En attente de la réponse de l'utilisateur.",
          "awaiting_user_input",
        );
      }
    }

    // Execute remaining tool calls in parallel
    if (otherCalls.length > 0) {
      if (otherCalls.length === 1) {
        // Single call — no overhead of Promise.allSettled
        toolResultParts.push(await processToolCall(otherCalls[0]));
      } else {
        // Multiple independent tool calls — run in parallel (order of results
        // matches order of otherCalls — required for tool_use / tool_result alignment).
        const settled = await Promise.allSettled(
          otherCalls.map((fc) => processToolCall(fc)),
        );
        for (let idx = 0; idx < settled.length; idx++) {
          const s = settled[idx];
          if (s.status === "fulfilled") {
            toolResultParts.push(s.value);
          } else {
            console.error("[engine] parallel tool exec rejected:", s.reason);
          }
        }
      }
    }

    state.history.push({ role: "user", parts: toolResultParts });

    // Work-state reminder: if the agent has been running non-state tools
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
                  "\nIf any open task above changed, call prospect_list action=task_update before starting new work. If the next phase has begun, mark that task in_progress.",
              },
            ],
          });
          state.successesSinceTodoTouch = 0;
        }
      } catch {
        // soft-fail — reminders are best-effort
      }
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
  /\b(?:prendre en compte|optimis\w*\s+(?:la|vos)\s+recherches?|je\s+m['’]?aligne)\b/i,
  // Announcing an imminent action (strong signal)
  /\bje\s+vais\s+(?:maintenant\s+)?(?:lancer|commencer|chercher|faire|cr[eé]er|appeler|ex[eé]cuter|utiliser|consulter|analyser|continuer|mettre|examiner|passer|v[eé]rifier|essayer|regarder|start|d[eé]marrer)\b/i,
  /\b(?:let\s+me|i['’]?ll|i\s+will|i\s+am\s+going\s+to)\s+(?:now\s+)?(?:search|call|run|use|execute|invoke|check|analyze|look|find|try|continue|proceed|start|begin|launch)\b/i,
  /\bi\s+am\s+going\s+to\s+start\b/i,
  /\b(?:going\s+to\s+start|about\s+to\s+(?:start|begin|run|launch)|gonna\s+(?:start|run|search))\b/i,
  /\bon\s+va\s+(?:maintenant\s+)?(?:lancer|commencer|chercher|faire|analyser|essayer|continuer)\b/i,
  /\b(commen[çc](?:e|ons|er)|launching|starting\s+(?:now|by|the|with))\b/i,
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
  if (
    /\bje\s+vais\s+(?:maintenant\s+)?(?:lancer|commencer|chercher|faire|cr[eé]er|appeler|ex[eé]cuter|utiliser|consulter|analyser|continuer|mettre|examiner|passer|v[eé]rifier|essayer|regarder|tenter)\b/i.test(t) ||
    /\bmaintenant\s+je\s+(?:mets|continue|cherche|v[eé]rifie|passe|tente|regarde|analyse|lance|commence)\b/i.test(t) ||
    /\b(?:i\s+will|i['’]?ll|let\s+me)\s+(?:now\s+)?(?:search|call|run|use|execute|check|analyze|continue|try|start|begin)\b/i.test(t)
  ) {
    return true;
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

function looksLikeProcessChatterOnly(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length === 0) return false;
  if (t.length > 700) return false;
  if (
    /\b(?:SIREN|SIRET)\s*[:#]?\s*\d{9,14}\b/i.test(t) ||
    /@[a-z0-9._%+-]+\.[a-z]{2,}/i.test(t) ||
    /\b(?:\+33|0)\s?[1-9](?:[\s().-]?\d{2}){4}\b/.test(t) ||
    /\|\s*[^|\n]+\s*\|/.test(t)
  ) {
    return false;
  }
  const lines = t
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length > 6) return false;
  const chatterLine = /^(?:bien s[ûu]r|d['’]?accord|ok|parfait|super|maintenant|ensuite|je\s+(?:commence|lance|vais|reprends|continue|mets|v[eé]rifie|cherche|tente|passe|consulte|regarde)|je\s+vais\s+maintenant|i\s+(?:will|am going to|will now)|let\s+me|now\s+i|next\s+i)\b/i;
  const actionWords = /\b(?:rechercher|chercher|lancer|commencer|continuer|reprendre|v[eé]rifier|consulter|enrichir|mettre [àa] jour|sauvegarder|browser|prospect_list|prospect_discovery|business_research|search|check|continue|resume|update|save|enrich)\b/i;
  const allChatter = lines.every((line) =>
    chatterLine.test(line) || (actionWords.test(line) && looksLikeIntentWithoutAction(line)),
  );
  if (!allChatter) return false;
  const substantiveSignals = /\b(?:trouv[eé]|identifi[eé]|voici|r[eé]sultat|dirigeant|g[eé]rant|pr[eé]sident|contact|t[eé]l[eé]phone|email|adresse|source|bloqu[eé]|rejet[eé]|complet|compl[eè]te|livrable)\b/i;
  return !substantiveSignals.test(t);
}

/**
 * Multi-step *roadmap* the model often emits instead of calling tools — looks
 * like a deliverable because of numbered steps but is only intent. If we treat
 * it as a final summary, the loop exits while `agent_todos` is still empty.
 */
function looksLikePlanningRoadmap(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 200) return false;
  const hasNumberedSteps = /(^|\n)\s*\d+\.\s+\S/m.test(t);
  if (!hasNumberedSteps) return false;
  const roadmapIntent =
    /\b(?:je\s+vais|j['']?ai\s+l['']?intention|nous\s+allons|on\s+va\s+(?:maintenant\s+)?(?:lancer|commencer)|i\s+am\s+going\s+to|i\s*'?ll\s+(?:start|begin)|let\s+me\s+(?:start|begin)|going\s+to\s+start|about\s+to\s+(?:start|begin|run|launch)|(?:launching|starting)\s+(?:the\s+)?(?:search|recherche|work))\b/i.test(
      t,
    );
  const planLabels =
    /\b(?:plan\s+d['']?action|mon\s+approche|mon\s+approach|my\s+approach|here\s+(?:is|'s)\s+(?:my\s+)?(?:plan|approach|strategy)|(?:voici|here\s+are)\s+(?:les\s+)?(?:étapes|steps|phases))\b/i.test(
      t,
    );
  if (!roadmapIntent && !planLabels) return false;
  // Real handoffs usually include concrete identifiers — exclude those
  if (
    /\|\s*[^\n|]+\s*\|/.test(t) ||
    /\b(?:siren|siret)\s*[:s]?\s*\d{9,14}\b/i.test(t) ||
    /@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(t)
  ) {
    return false;
  }
  return true;
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
      if (
        looksLikeFinalSummary(text) &&
        !looksLikePlanningRoadmap(text)
      ) {
        return true;
      }
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
    if (looksLikeFinalSummary(text) && !looksLikePlanningRoadmap(text))
      return text;
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
 * recreate the task list, after it has already delivered a final answer. This
 * is the Nancy-style loop ("Bonjour ! Voici mon plan …" × 4).
 *
 * Conservative: we require BOTH a greeting OR a plan-intent phrase AND a
 * prospect_list task_create call, so we never misfire on the legitimate first turn
 * of a brand new task.
 */
function looksLikeRestart(
  text: string | null | undefined,
  calls: ReadonlyArray<{ name: string; args?: Record<string, unknown> }>,
): boolean {
  const hasTaskCreate = calls.some(isV1TaskCreateCall);
  if (!hasTaskCreate) return false;
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

function isV1TaskCreateCall(call: {
  name: string;
  args?: Record<string, unknown>;
}): boolean {
  return (
    call.name === "prospect_list" &&
    String(call.args?.action || "").toLowerCase() === "task_create"
  );
}

function hasSubstantiveWorkCall(
  calls: ReadonlyArray<{ name: string; args?: Record<string, unknown> }>,
): boolean {
  return calls.some((call) => {
    if (call.name === "ask_user") return false;
    if (call.name !== "prospect_list") return true;
    const action = String(call.args?.action || "").toLowerCase();
    return !["task_create", "task_list", "status"].includes(action);
  });
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
      ? " PROFONDEUR LEAD-GEN (dans le JSON) : (a) cohérence entité légale / adresse Maps / homonyme, (b) « pas de site » vs website_url, (c) progression vers **N lignes CRM** sans inventer ni sacrifier la triangulation."
      : "";

  const reflectionSchema = `{"observation": "...", "conclusion": "...", "next_action": "...", "strategy_revision": "...|null"}`;
  const strategyRevisionHint = ` The \`strategy_revision\` field is CRITICAL: if your current approach is not working (wrong order, too slow, bad results), write a concrete strategy change here. If the current approach is fine, set it to null.`;

  const nudge = dueToError
    ? [
        "Erreurs outils répétées — réflexion interne uniquement (pas affichée à l’utilisateur).",
        "Réponds par un unique objet JSON — pas de prose hors JSON, pas de barres à code — modèle exact :",
        reflectionSchema,
        "Chaque champ : 2 phrases max. Dans next_action : quelle todo compléter / passer en cours." +
          strategyRevisionHint +
          leadGenDepthBlock +
          todoBlock,
      ].join(" ")
    : [
        "Réflexion interne uniquement (pas pour l’utilisateur final).",
        "Réponds par un unique objet JSON — pas de prose hors JSON — modèle exact :",
        reflectionSchema,
        "Chaque champ : 2 phrases max. Dans next_action : todo à mettre à jour si besoin." +
          strategyRevisionHint +
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
    strategyRevision: parsed.strategyRevision || undefined,
  };
  await config.onReflection?.(reflection);

  const rev = parsed.strategyRevision?.trim();
  if (rev && rev.length > 5 && !/^null$/i.test(rev)) {
    state.history.push({
      role: "user",
      parts: [
        {
          type: "text",
          text:
            "[STRATEGY_REVISION — à appliquer pour la suite de cette session sauf si les faits contredisent]\n" +
            rev.slice(0, 4000),
        },
      ],
    });
  }
}

function parseReflection(
  text: string | null | undefined,
): {
  observation: string;
  conclusion: string;
  nextAction: string;
  strategyRevision: string;
} {
  if (!text)
    return { observation: "", conclusion: "", nextAction: "", strategyRevision: "" };
  // Strip common code-fence wrapping
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  // Try strict JSON first
  try {
    const obj = JSON.parse(cleaned) as Record<string, unknown>;
    const sr = obj.strategy_revision ?? obj.strategyRevision ?? obj.StrategyRevision;
    return {
      observation: String(obj.observation ?? obj.Observation ?? "").slice(0, 2000),
      conclusion: String(obj.conclusion ?? obj.Conclusion ?? "").slice(0, 2000),
      nextAction: String(
        obj.next_action ?? obj.nextAction ?? obj.NextAction ?? "",
      ).slice(0, 1000),
      strategyRevision: String(sr ?? "").slice(0, 4000),
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
  const strategyRevision = pick(
    /strategy_revision[\s:\-]+([\s\S]*?)(?=\n\s*(?:next|observation|conclusion)|$)/i,
  );
  return {
    observation,
    conclusion,
    nextAction: nextAction.slice(0, 1000),
    strategyRevision: strategyRevision.slice(0, 4000),
  };
}

export function toolsFromRegistry(
  names: string[],
  getDef: (name: string) => ToolDefinition | undefined,
): ToolDefinition[] {
  return names.map((n) => getDef(n)).filter(Boolean) as ToolDefinition[];
}
