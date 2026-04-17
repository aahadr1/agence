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
}

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
  const state: AgentState = {
    history: [...priorHistory],
    consecutiveErrors: 0,
    lastReflectionIter: 0,
    nudgesSinceToolSuccess: 0,
    finalSummaryDelivered: false,
    openWorkNudgeCount: 0,
    totalNudges: 0,
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

      // Last line of defense: if there's still open work (pending todos,
      // awaiting approvals handled separately), don't let the model silently
      // give up. BUT only if we haven't already hit the nudge budget — and
      // only if the model hasn't just delivered a substantial final message
      // (which is probably the real answer the user wants).
      if (canStillNudge && config.checkOpenWork && !thisTurnIsFinalSummary) {
        try {
          const check = await config.checkOpenWork();
          if (check.open) {
            // If we've already delivered a final summary AND the open work is
            // just leftover todos, auto-finalize them so the session can close
            // instead of looping. The caller supplies `finalizeOpenWork` for
            // this; if unavailable we fall back to a single extra nudge.
            if (
              state.finalSummaryDelivered &&
              state.openWorkNudgeCount >= 1 &&
              config.finalizeOpenWork
            ) {
              try {
                const summary = await config.finalizeOpenWork();
                finalMessage = result.text || "Done.";
                await config.onNudge?.(
                  `Auto-finalized leftover todos: ${summary || "cleared open work"}`,
                  "auto_finalize",
                );
                return buildResult(finalMessage, "completed");
              } catch (e) {
                // fall through to the plain nudge if finalize fails
                console.warn("[engine] auto-finalize failed:", e);
              }
            }

            state.openWorkNudgeCount++;
            const nudge =
              `You stopped but there is still open work: ${check.summary || "pending todos remain"}. ` +
              "Either execute the next tool, call `todo_update` (use a 1-based index like \"1\" or the alias \"current\"), or call `todo_finalize` if the whole task is already delivered. Do not stop silently.";
            pushNudge(state, nudge);
            await config.onNudge?.(nudge, "open_work_remaining");
            state.consecutiveErrors++;
            continue;
          }
        } catch {
          // soft-fail the check; proceed to completion
        }
      }

      finalMessage = result.text || "Done.";
      return buildResult(finalMessage, "completed");
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
  const nudge = dueToError
    ? [
        "You hit repeated tool errors. Pause and reflect (for yourself only, NOT as a user-facing message).",
        "Respond with a single JSON object — no prose outside the JSON, no code fences — shaped exactly as:",
        `{"observation": "...", "conclusion": "...", "next_action": "..."}`,
        "Keep each field under 2 short sentences. After this reflection, the next turn will resume tool use.",
      ].join(" ")
    : [
        "Pause and reflect internally (not shown to the user).",
        "Respond with a single JSON object — no prose outside the JSON, no code fences — shaped exactly as:",
        `{"observation": "...", "conclusion": "...", "next_action": "..."}`,
        "Keep each field under 2 short sentences. After this reflection the next turn will resume tool use.",
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
