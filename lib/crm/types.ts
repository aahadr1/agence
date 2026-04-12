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

export type CrmAccount = {
  id: string;
  org_id: string;
  name: string;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  niche: string | null;
  source: string;
  owner_user_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmContact = {
  id: string;
  org_id: string;
  account_id: string | null;
  full_name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  linkedin_url: string | null;
  owner_user_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProspectTemperature = "hot" | "warm" | "cold";

export type ProspectListItem = {
  id: string;
  title: string;
  description: string | null;
  status: CrmOpportunityStatus;
  stage_id: string;
  stage_name: string;
  stage_color: string;
  stage_sort_order: number;
  amount_cents: number;
  currency: string;
  probability: number;
  expected_close_date: string | null;
  owner_user_id: string | null;
  source: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  account_name: string | null;
  account_phone: string | null;
  account_email: string | null;
  account_website: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_role: string | null;
  contact_linkedin: string | null;
  last_activity_at: string | null;
  last_activity_type: CrmActivityType | null;
  open_task_count: number;
  overdue_task_count: number;
  next_task_due: string | null;
  temperature: ProspectTemperature;
};

export type ProspectTableColumn = {
  key: string;
  label: string;
  visible: boolean;
  width?: number;
  sortable: boolean;
};

export type SavedView = {
  id: string;
  name: string;
  filters: Record<string, string | string[]>;
  columns: string[];
  sort_by: string;
  sort_dir: "asc" | "desc";
};

export type ProspectDetail = {
  opportunity: CrmOpportunity;
  account: CrmAccount | null;
  contact: CrmContact | null;
  activities: CrmActivity[];
  tasks: CrmTask[];
  stageHistory: Array<{
    id: string;
    from_stage_id: string | null;
    to_stage_id: string;
    changed_by: string | null;
    changed_at: string;
  }>;
  calendarLinks: Array<{ event_id: string; entity_type: string; entity_id: string }>;
  stages: CrmStage[];
};
