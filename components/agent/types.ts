export type SessionStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "paused"
  | "completed"
  | "failed"
  | string;

export interface Session {
  id: string;
  org_id?: string;
  title: string | null;
  status: SessionStatus;
  model: string;
  cost_cents: number;
  capability_packs: string[];
  created_at: string;
  updated_at?: string;
  last_tick_at?: string | null;
}

export type MessageRole =
  | "user"
  | "assistant"
  | "thinking"
  | "system"
  | "plan"
  | "error"
  | "approval_request"
  | "approval_response";

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
}

export interface Todo {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  position: number;
}

export interface Reflection {
  id: string;
  iteration: number;
  observation: string;
  conclusion: string;
  next_action: string | null;
  created_at: string;
}

export interface Approval {
  id: string;
  action: string;
  details: string;
  risk: "low" | "medium" | "high";
  status: "awaiting" | "approved" | "rejected" | "expired";
  created_at: string;
}

/** ----------------------------------------------------------------------- */
/** Timeline events — unified discriminated union consumed by the renderer */

export type TimelineEvent =
  | {
      kind: "user";
      id: string;
      content: string;
      at: string;
    }
  | {
      kind: "assistant";
      id: string;
      content: string;
      at: string;
      metadata?: Record<string, unknown> | null;
    }
  | {
      kind: "plan";
      id: string;
      content: string;
      at: string;
    }
  | {
      kind: "error";
      id: string;
      content: string;
      at: string;
    }
  | {
      kind: "approval_request";
      id: string;
      content: string;
      at: string;
      approval_id: string;
      details?: string;
      risk?: "low" | "medium" | "high";
    }
  | {
      kind: "approval_response";
      id: string;
      content: string;
      at: string;
    }
  | {
      kind: "thinking";
      id: string;
      content: string;
      at: string;
    }
  | {
      kind: "nudge";
      id: string;
      content: string;
      at: string;
      reason: string;
    }
  | {
      kind: "reflection";
      id: string;
      iteration: number;
      observation: string;
      conclusion: string;
      next_action: string | null;
      at: string;
    }
  | {
      kind: "tool";
      id: string;
      content: string;
      at: string;
      tool?: string;
      status?: string;
    };

export interface CapabilityPreset {
  id: string;
  label: string;
  packs: string[];
  description: string;
  hint?: string;
}
