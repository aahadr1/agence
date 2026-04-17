/**
 * Anthropic Claude agent wrapper with extended thinking + tool use.
 *
 * Claude Sonnet 4.5 supports:
 *  - "thinking" blocks (extended reasoning) via { thinking: { type: "enabled" } }
 *  - tool_use / tool_result content blocks
 *  - interleaved thinking between tool calls
 *
 * We expose callClaude() which mirrors the shape returned by callGemini() so
 * both providers plug into the same agent loop.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  AgentMessage,
  AgentMessagePart,
  LLMCallResult,
  LLMToolDefinition,
} from "./llm-types";
import type { AgentModel } from "@/lib/agent/types";

const MODEL_MAP: Partial<Record<AgentModel, string>> = {
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
  "claude-haiku-4": "claude-haiku-4-5-20251001",
};

// Pricing in cents per million tokens (2026 Anthropic list prices)
const COST_PER_M_INPUT: Partial<Record<AgentModel, number>> = {
  "claude-sonnet-4-5": 300,
  "claude-haiku-4": 80,
};
const COST_PER_M_OUTPUT: Partial<Record<AgentModel, number>> = {
  "claude-sonnet-4-5": 1500,
  "claude-haiku-4": 400,
};

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

function toClaudeTools(tools: LLMToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => {
    const properties: Record<string, unknown> = {};
    for (const [key, p] of Object.entries(t.parameters)) {
      const prop: Record<string, unknown> = {
        type: p.type,
        description: p.description,
      };
      if (p.enum) prop.enum = p.enum;
      if (p.items) prop.items = p.items;
      properties[key] = prop;
    }
    return {
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object",
        properties: properties as Record<string, { type: string }>,
        required:
          t.required ||
          Object.entries(t.parameters)
            .filter(([, p]) => p.required !== false)
            .map(([k]) => k),
      },
    };
  });
}

function toClaudeMessages(
  history: AgentMessage[],
): Anthropic.MessageParam[] {
  return history.map((m) => ({
    role: m.role,
    content: m.parts.map((p): Anthropic.ContentBlockParam => {
      switch (p.type) {
        case "text":
          return { type: "text", text: p.text };
        case "thinking":
          return {
            type: "thinking",
            thinking: p.thinking,
            signature: p.signature || "",
          };
        case "tool_use":
          return {
            type: "tool_use",
            id: p.id,
            name: p.name,
            input: p.input,
          };
        case "tool_result":
          return {
            type: "tool_result",
            tool_use_id: p.toolUseId,
            content: p.content,
            is_error: p.isError,
          };
        default: {
          const _exhaustive: never = p;
          throw new Error(`Unhandled part: ${JSON.stringify(_exhaustive)}`);
        }
      }
    }),
  }));
}

export interface CallClaudeOpts {
  model: AgentModel;
  systemPrompt: string;
  history: AgentMessage[];
  tools?: LLMToolDefinition[];
  maxRetries?: number;
  /** Enable extended thinking (default true for sonnet, false for haiku) */
  extendedThinking?: boolean;
  maxTokens?: number;
}

export async function callClaude(opts: CallClaudeOpts): Promise<LLMCallResult> {
  const {
    model,
    systemPrompt,
    history,
    tools,
    maxRetries = 2,
    extendedThinking,
    maxTokens = 8192,
  } = opts;

  const modelId = MODEL_MAP[model];
  if (!modelId) throw new Error(`Unsupported Claude model: ${model}`);

  const client = getClient();
  const useThinking =
    extendedThinking !== undefined
      ? extendedThinking
      : model === "claude-sonnet-4-5";

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await client.messages.create({
        model: modelId,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: toClaudeMessages(history),
        ...(tools && tools.length > 0 ? { tools: toClaudeTools(tools) } : {}),
        ...(useThinking
          ? { thinking: { type: "enabled", budget_tokens: 4000 } }
          : {}),
      });

      const parts: AgentMessagePart[] = [];
      let textContent = "";
      let thinkingContent = "";
      let thinkingSignature: string | undefined;
      const functionCalls: LLMCallResult["functionCalls"] = [];

      for (const block of res.content) {
        if (block.type === "thinking") {
          thinkingContent += block.thinking;
          thinkingSignature = block.signature;
          parts.push({
            type: "thinking",
            thinking: block.thinking,
            signature: block.signature,
          });
        } else if (block.type === "text") {
          textContent += block.text;
          parts.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          functionCalls.push({
            id: block.id,
            name: block.name,
            args: (block.input as Record<string, unknown>) || {},
          });
          parts.push({
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: (block.input as Record<string, unknown>) || {},
          });
        }
      }

      const inputTokens = res.usage?.input_tokens || 0;
      const outputTokens = res.usage?.output_tokens || 0;
      const costCents = estimateClaudeCostCents(
        model,
        inputTokens,
        outputTokens,
      );

      return {
        text: textContent,
        thinking: thinkingContent,
        thinkingSignature,
        functionCalls,
        assistantParts: parts,
        inputTokens,
        outputTokens,
        costCents,
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error("callClaude failed");
}

export function estimateClaudeCostCents(
  model: AgentModel,
  inputTokens: number,
  outputTokens: number,
): number {
  const inRate = COST_PER_M_INPUT[model] || 0;
  const outRate = COST_PER_M_OUTPUT[model] || 0;
  const inCost = (inputTokens / 1_000_000) * inRate;
  const outCost = (outputTokens / 1_000_000) * outRate;
  return Math.ceil(inCost + outCost);
}
