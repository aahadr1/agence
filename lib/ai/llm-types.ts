/**
 * Provider-neutral message & call types used by the agent engine.
 * Both Claude and Gemini adapters consume/produce these shapes.
 */

import type { ToolDefinition } from "@/lib/agent/types";

export type AgentMessagePart =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string;
      isError?: boolean;
    }
  | { type: "thinking"; thinking: string; signature?: string };

export interface AgentMessage {
  role: "user" | "assistant";
  parts: AgentMessagePart[];
}

/** Trimmed ToolDefinition exposed to LLM adapters */
export type LLMToolDefinition = ToolDefinition;

export interface LLMCallResult {
  text: string;
  thinking: string;
  thinkingSignature?: string;
  functionCalls: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  /** The raw assistant parts — used to faithfully replay thinking/tool_use blocks in subsequent turns (Claude extended thinking requires this) */
  assistantParts: AgentMessagePart[];
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}
