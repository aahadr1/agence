export type CrmTaskStatus = "todo" | "in_progress" | "done" | "cancelled";
export type CrmTaskPriority = "low" | "medium" | "high";
export type CrmOpportunityStatus = "open" | "won" | "lost" | "archived";
export type CrmActivityType =
  | "note"
  | "call"
  | "meeting"
  | "email"
  | "system"
  | "stage_change";

export type CrmStage = {
  id: string;
  pipeline_id: string;
  name: string;
  sort_order: number;
  color: string;
  is_closed_won: boolean;
  is_closed_lost: boolean;
};

export type CrmOpportunity = {
  id: string;
  org_id: string;
  pipeline_id: string;
  stage_id: string;
  account_id: string | null;
  primary_contact_id: string | null;
  title: string;
  description: string | null;
  owner_user_id: string | null;
  amount_cents: number;
  currency: string;
  probability: number;
  expected_close_date: string | null;
  status: CrmOpportunityStatus;
  loss_reason: string | null;
  source: string;
  tags: string[];
  sort_order: number;
  won_at: string | null;
  lost_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmTask = {
  id: string;
  org_id: string;
  opportunity_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  title: string;
  description: string | null;
  status: CrmTaskStatus;
  priority: CrmTaskPriority;
  due_at: string | null;
  reminder_at: string | null;
  assigned_to: string | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmActivity = {
  id: string;
  org_id: string;
  opportunity_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  task_id: string | null;
  type: CrmActivityType;
  body: string | null;
  metadata: Record<string, unknown>;
  happened_at: string;
  created_by: string | null;
  created_at: string;
};
