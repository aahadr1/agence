/**
 * Core types for the Agent V3 engine.
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
  /** If set, the tool will refuse execution unless this OAuth connection exists */
  requiredConnection?: "google" | "slack" | "notion" | "github";
  /** If true, the tool performs a destructive or sensitive action — engine may force approval */
  destructive?: boolean;
}

export interface ToolResult {
  name: string;
  result: unknown;
  error?: string;
  durationMs: number;
  costCents: number;
}

/**
 * Todo item tracked by the agent — mirrors Claude Code's todo list structure.
 */
export interface AgentTodo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  position: number;
}

export interface AgentReflection {
  iteration: number;
  observation: string;
  conclusion: string;
  nextAction: string;
}

export interface AgentApprovalRequest {
  id: string;
  action: string;
  details: string;
  risk: "low" | "medium" | "high";
}

export interface AgentContext {
  /** Legacy mission id (kept for compat with lead-gen tools like save_lead) */
  missionId: string;
  /** Preferred: agent session id */
  sessionId: string;
  orgId: string;
  userId: string;
  /** In-memory scratchpad; for persistent memory use memory_write tool */
  scratchpad: Map<string, unknown>;
  totalCostCents: number;
  budgetCapCents: number | null;
  iterationCount: number;
  maxIterations: number;
  /** Active capability packs (e.g. ["lead-gen-fr", "email", "calendar"]) */
  capabilityPacks: string[];
  /** Tokens so far this run (for context compaction decisions) */
  inputTokensSoFar: number;
}

export type AgentModel =
  | "claude-sonnet-4-5"
  | "claude-haiku-4"
  | "gemini-2.5-pro"
  | "gemini-2.5-flash";

export interface AgentConfig {
  systemPrompt: string;
  tools: ToolDefinition[];
  model: AgentModel;
  maxIterations: number;
  /** Every N iterations, force a self-reflection step. Set 0 to disable. Default 5. */
  reflectEveryN?: number;
  /** Context-compaction threshold (fraction of model window). Default 0.6. */
  compactionThreshold?: number;
  onThinking?: (text: string) => void | Promise<void>;
  onToolCall?: (name: string, params: Record<string, unknown>) => void | Promise<void>;
  onToolResult?: (result: ToolResult) => void | Promise<void>;
  onMessage?: (text: string) => void | Promise<void>;
  onReflection?: (r: AgentReflection) => void | Promise<void>;
  onApprovalRequest?: (a: AgentApprovalRequest) => void | Promise<void>;
  /** Fired when the engine injects a hidden corrective nudge (pseudo-code detected, etc.) */
  onNudge?: (text: string, reason: string) => void | Promise<void>;
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

export type SessionStatus =
  | "pending"
  | "planning"
  | "awaiting_approval"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** Legacy alias */
export type MissionStatus = SessionStatus;
export type MissionMode = "A" | "B" | "C";

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
  role:
    | "user"
    | "assistant"
    | "thinking"
    | "system"
    | "plan"
    | "error"
    | "approval_request"
    | "approval_response";
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

/**
 * Capability packs bundle tool allowlists + domain instructions.
 * Activated per-session via the `capability_packs` column.
 */
export type CapabilityPack =
  | "lead-gen-fr"
  | "email"
  | "calendar"
  | "web-research"
  | "browser";
