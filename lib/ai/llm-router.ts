/**
 * LLM router: dispatches agent loop calls to the right provider.
 *
 * Default: Claude Sonnet 4.5 (extended thinking).
 * Fallback: Gemini 2.5 Pro (already used for lead-gen v2).
 *
 * Engine talks provider-neutral AgentMessage[] — adapters convert to
 * each provider's native format.
 */

import { callClaude } from "./claude-agent";
import {
  callGemini,
  estimateCostCents as estimateGeminiCost,
} from "./gemini-agent";
import type {
  AgentMessage,
  AgentMessagePart,
  LLMCallResult,
  LLMToolDefinition,
} from "./llm-types";
import type { AgentModel } from "@/lib/agent/types";
import type { Content, Part } from "@google/generative-ai";

export type { AgentMessage, AgentMessagePart, LLMCallResult, LLMToolDefinition };

export interface CallLLMOpts {
  model: AgentModel;
  systemPrompt: string;
  history: AgentMessage[];
  tools?: LLMToolDefinition[];
  maxRetries?: number;
}

export async function callLLM(opts: CallLLMOpts): Promise<LLMCallResult> {
  const { model } = opts;
  if (model.startsWith("claude")) {
    return callClaude(opts);
  }
  if (model.startsWith("gemini")) {
    return callGeminiAdapter(opts);
  }
  throw new Error(`Unknown model provider: ${model}`);
}

// ---------------------------------------------------------------------------
// Gemini adapter (converts AgentMessage <-> Gemini Content)
// ---------------------------------------------------------------------------

async function callGeminiAdapter(opts: CallLLMOpts): Promise<LLMCallResult> {
  const geminiHistory: Content[] = opts.history.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: m.parts
      .filter((p) => p.type !== "thinking") // Gemini has no thinking blocks
      .map((p): Part => {
        if (p.type === "text") return { text: p.text };
        if (p.type === "tool_use") {
          return {
            functionCall: { name: p.name, args: p.input },
          } as unknown as Part;
        }
        if (p.type === "tool_result") {
          let parsed: unknown = p.content;
          try {
            parsed = JSON.parse(p.content);
          } catch {
            /* keep as string */
          }
          return {
            functionResponse: {
              name: p.toolUseId,
              response: { result: parsed },
            },
          } as unknown as Part;
        }
        return { text: "" };
      }),
  }));

  const res = await callGemini({
    model: opts.model as "gemini-2.5-pro" | "gemini-2.5-flash",
    systemPrompt: opts.systemPrompt,
    history: geminiHistory,
    tools: opts.tools,
    maxRetries: opts.maxRetries,
  });

  const assistantParts: AgentMessagePart[] = [];
  if (res.text) assistantParts.push({ type: "text", text: res.text });
  const functionCalls = res.functionCalls.map((fc, i) => {
    const id = `gemini_${Date.now()}_${i}`;
    assistantParts.push({
      type: "tool_use",
      id,
      name: fc.name,
      input: fc.args,
    });
    return { id, name: fc.name, args: fc.args };
  });

  return {
    text: res.text,
    thinking: res.thinking,
    functionCalls,
    assistantParts,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costCents: res.costCents,
  };
}

// Re-export for convenience
export { estimateGeminiCost };
