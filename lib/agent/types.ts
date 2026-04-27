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

export type ToolRiskLevel = "green" | "yellow" | "red";

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
  /** Permission class for audit / hard blocks (see lib/agent/os/permissions.ts). */
  riskLevel?: ToolRiskLevel;
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
  /** Non-empty when the model commits to a concrete strategy change mid-run */
  strategyRevision?: string;
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
  /**
   * Stub `lead_searches.id` for this session (set by the ticker on lead-gen ticks).
   * `save_lead` / `batch_save_leads` fall back to `ensureAgentLeadSearchId` and cache here.
   */
  leadSearchId?: string;
  /**
   * When lead-gen-fr is active, blocks `todo_finalize` until enough CRM rows exist
   * for this session (same rule as `checkOpenWork`).
   */
  leadGenFinalizeGate?: () => Promise<{ ok: boolean; message?: string }>;
  /** Same-tick cache; durable scratchpad uses `scratchpad_write` → agent_memory */
  scratchpad: Map<string, unknown>;
  totalCostCents: number;
  budgetCapCents: number | null;
  iterationCount: number;
  maxIterations: number;
  /** Active capability packs (e.g. ["lead-gen-fr", "email", "calendar"]) */
  capabilityPacks: string[];
  /** Tokens so far this run (for context compaction decisions) */
  inputTokensSoFar: number;
  /**
   * When set (lead-gen ticks), `google_maps_search` bumps `max_results` to at
   * least this value so discovery pools are large enough vs CRM target.
   */
  leadGenDiscoveryMinResults?: number;
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
  /**
   * Called when the model produces no tool call to decide whether the session
   * is truly done. If it returns { open: true, summary }, the engine injects a
   * nudge with the summary and continues the loop instead of marking complete.
   */
  checkOpenWork?: () => Promise<{ open: boolean; summary?: string }>;
  /**
   * Called by the engine to auto-close any leftover pending/in_progress todos
   * after a final summary has already been delivered. The engine uses this as
   * a graceful escape hatch instead of nudging the model forever.
   * Should return a short human-readable summary of what was closed.
   */
  finalizeOpenWork?: () => Promise<string | null>;
  /**
   * Called by the engine before forced reflection / periodic reminders so it
   * can inject a compact snapshot of the current todo list. Returning an
   * empty string disables the snapshot for that turn.
   */
  todoSnapshot?: () => Promise<string>;
  /**
   * When true, forced reflection nudges include a lead-gen verification checklist
   * (model must still reply with JSON only — see engine).
   */
  reflectionLeadGenDepth?: boolean;
  /**
   * Called before auto-finalizing todos to verify whether the session's actual
   * deliverable is ready (e.g. enough leads saved). If it returns false, the
   * engine resets the "final summary" flag and nudges the agent to continue
   * instead of closing out prematurely.
   */
  isDeliverableComplete?: () => Promise<boolean>;
  /**
   * V1 work-state gate. When true, the model must create durable task state
   * through an allowed tool before it can perform substantive work.
   */
  requiresTaskState?: boolean;
  /** Returns true once durable task/work state exists for the session. */
  hasTaskState?: () => Promise<boolean>;
  /**
   * Max consecutive nudges before yielding (per no-tool-call streak).
   * Default: 3. Lead-gen sessions should use 5.
   */
  maxNudgesBeforeYield?: number;
  /**
   * Hard cap on total nudges per tick. Default: 6. Lead-gen sessions
   * should use 10.
   */
  maxTotalNudges?: number;
  /**
   * Runtime hints from the session host (ticker) — tune nudge wording without
   * importing DB helpers into the engine.
   */
  sessionHints?: {
    /** True when this tick appended a user follow-up reinforcement message */
    userFollowUpAppended?: boolean;
  };
  /**
   * If true (e.g. session cancelled in DB), the loop stops before the next
   * LLM / tool batch — hard cancel inside a tick.
   */
  shouldAbort?: () => Promise<boolean>;
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
  | "browser"
  | "self-coding"
  | "agent-os";
