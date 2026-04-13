/**
 * Core types for the Lead Agent v2 multi-agent engine.
 */

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  enum?: string[];
  items?: { type: string };
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  required?: string[];
  costEstimateCents?: number;
}

export interface ToolResult {
  name: string;
  result: unknown;
  error?: string;
  durationMs: number;
  costCents: number;
}

export interface AgentContext {
  missionId: string;
  orgId: string;
  userId: string;
  scratchpad: Map<string, unknown>;
  totalCostCents: number;
  budgetCapCents: number | null;
  iterationCount: number;
  maxIterations: number;
}

export type AgentModel = "gemini-2.5-pro" | "gemini-2.5-flash";

export interface AgentConfig {
  systemPrompt: string;
  tools: ToolDefinition[];
  model: AgentModel;
  maxIterations: number;
  onThinking?: (text: string) => void | Promise<void>;
  onToolCall?: (name: string, params: Record<string, unknown>) => void | Promise<void>;
  onToolResult?: (result: ToolResult) => void | Promise<void>;
  onMessage?: (text: string) => void | Promise<void>;
}

export type SubAgentRole =
  | "strategist"
  | "discovery"
  | "qualifier"
  | "owner_finder"
  | "contact_finder"
  | "verifier"
  | "deduplicator"
  | "reporter";

export type MissionMode = "A" | "B" | "C";

export type MissionStatus =
  | "pending"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface MissionPlan {
  steps: {
    label: string;
    description: string;
    estimatedMinutes: number;
    subAgents: SubAgentRole[];
  }[];
  estimatedTotalMinutes: number;
  estimatedCostCents: number;
  maxParallelAgents: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "thinking" | "system" | "plan" | "error";
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
