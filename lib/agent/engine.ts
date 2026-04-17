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
}

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
      const pseudo = detectPseudoToolCall(result.text);
      if (pseudo) {
        const nudge =
          `You just emitted a tool reference as text ("${pseudo}") instead of actually invoking a tool.` +
          ` That text does NOT execute anything.` +
          ` Re-do this turn: call the tool you intended via the function-calling API.` +
          ` Do NOT wrap tool calls in code fences or <tool_code> blocks.`;
        state.history.push({
          role: "user",
          parts: [{ type: "text", text: nudge }],
        });
        await config.onNudge?.(nudge, "pseudo_tool_call");
        state.consecutiveErrors++;
        continue;
      }

      if (looksLikeIntentWithoutAction(result.text)) {
        const nudge =
          "You described the next step but did not call any tool. Execute it now by invoking the appropriate tool. If you truly have nothing left to do, say so explicitly and summarize — don't just describe an action.";
        state.history.push({
          role: "user",
          parts: [{ type: "text", text: nudge }],
        });
        await config.onNudge?.(nudge, "intent_without_action");
        state.consecutiveErrors++;
        continue;
      }

      // Last line of defense: if there's still open work (pending todos,
      // awaiting approvals handled separately), don't let the model silently
      // give up. Force it to either execute the next step or explicitly
      // acknowledge abandonment.
      if (config.checkOpenWork) {
        try {
          const check = await config.checkOpenWork();
          if (check.open) {
            const nudge =
              `You stopped but there is still open work: ${check.summary || "pending todos remain"}. ` +
              "Continue now by invoking the next tool you need. If you genuinely cannot proceed, call `ask_user` for clarification, or mark the blocked todos as cancelled with `todo_update` and then summarize. Do not stop silently.";
            state.history.push({
              role: "user",
              parts: [{ type: "text", text: nudge }],
            });
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
      if (toolResult.error) state.consecutiveErrors++;
      else state.consecutiveErrors = 0;

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
  // Announcing an imminent action
  /\b(maintenant|now|je\s+vais|je\s+lance|let\s+me|i['’]?ll|i\s+will|i\s+am\s+going\s+to|on\s+va|on\s+commence|on\s+lance)\b/i,
  /\b(commence|commencer|launching|starting|going\s+to\s+(?:run|call|use|execute|invoke))\b/i,
  /\b(first\s+step|premi[eè]re?\s+[eé]tape|étape\s*1|step\s*1)\b/i,
  // Describing remaining/next work
  /\b(prochaine?\s+(?:action|[eé]tape|chose)|next\s+(?:action|step|move))\b/i,
  /\b(il\s+me\s+(?:reste|manque)|i\s+(?:still|need\s+to)|still\s+(?:need|have)\s+to|remaining|restant|à\s+faire|to\s+do)\b/i,
  /\b(je\s+dois|i\s+must|i\s+should|il\s+faut)\b/i,
  /\b(continu\w+|reprendre|resume|keep\s+going)\b/i,
];

/**
 * Detect an "I will do X" style closing where the model describes its next
 * action but never actually calls a tool. We treat this as a mistake (the
 * model should either call the tool or genuinely summarize and stop).
 */
function looksLikeIntentWithoutAction(
  text: string | null | undefined,
): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 10) return false;
  // Very short final replies like "OK, done." are fine — skip
  if (t.length < 40 && /\b(done|ok|okay|termin[eé]|voilà|vu)\b/i.test(t)) {
    return false;
  }
  let hits = 0;
  for (const re of INTENT_PATTERNS) {
    if (re.test(t)) hits++;
  }
  return hits >= 1;
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
 * produce a reflection). The result is surfaced via onReflection + pushed back
 * into the history so the next iteration benefits from it.
 */
async function runForcedReflection(
  state: AgentState,
  config: AgentConfig,
  context: AgentContext,
  dueToError: boolean,
) {
  const nudge = dueToError
    ? "You hit repeated tool errors. Before doing anything else, reflect: what went wrong, what should change, and what's the next concrete action?"
    : "Pause and reflect: given the work done so far, are you on track? What have you learned, what's missing, what's the next concrete action?";

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

  if (result.text) {
    await config.onMessage?.(result.text);
  }

  const reflection: AgentReflection = {
    iteration: context.iterationCount,
    observation: result.thinking || "",
    conclusion: result.text || "",
    nextAction: "",
  };
  await config.onReflection?.(reflection);
}

export function toolsFromRegistry(
  names: string[],
  getDef: (name: string) => ToolDefinition | undefined,
): ToolDefinition[] {
  return names.map((n) => getDef(n)).filter(Boolean) as ToolDefinition[];
}
