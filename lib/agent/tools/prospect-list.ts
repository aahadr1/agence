import type { SupabaseClient } from "@supabase/supabase-js";
import { registerTool } from "../tool-registry";
import type { AgentContext } from "../types";
import { ensureAgentLeadSearchId } from "../lead-search-stub";
import { getAgentDb } from "./_db";

type ProspectRow = Record<string, unknown>;
type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
type WorkspaceTask = {
  id: string;
  content: string;
  status: TaskStatus;
  position: number;
  notes?: string | null;
  updated_at: string;
};

const WORKSPACE_KEY = "v1_prospect_workspace";

async function loadWorkspace(sessionId: string): Promise<{
  prospects: ProspectRow[];
  rejected: ProspectRow[];
  tasks: WorkspaceTask[];
  blocker_summary: string | null;
  exported_at: string | null;
  exported_count: number;
}> {
  const db = getAgentDb();
  const { data } = await db
    .from("agent_memory")
    .select("value")
    .eq("session_id", sessionId)
    .eq("key", WORKSPACE_KEY)
    .maybeSingle();
  const value = data?.value as
    | {
        prospects?: ProspectRow[];
        rejected?: ProspectRow[];
        tasks?: WorkspaceTask[];
        blocker_summary?: string | null;
        exported_at?: string | null;
        exported_count?: number;
      }
    | undefined;
  return {
    prospects: Array.isArray(value?.prospects) ? value.prospects : [],
    rejected: Array.isArray(value?.rejected) ? value.rejected : [],
    tasks: Array.isArray(value?.tasks) ? value.tasks : [],
    blocker_summary:
      typeof value?.blocker_summary === "string" ? value.blocker_summary : null,
    exported_at: typeof value?.exported_at === "string" ? value.exported_at : null,
    exported_count:
      typeof value?.exported_count === "number" ? value.exported_count : 0,
  };
}

async function saveWorkspace(
  sessionId: string,
  workspace: {
    prospects: ProspectRow[];
    rejected: ProspectRow[];
    tasks: WorkspaceTask[];
    blocker_summary: string | null;
    exported_at: string | null;
    exported_count: number;
  },
): Promise<void> {
  const db = getAgentDb();
  await db.from("agent_memory").upsert(
    {
      session_id: sessionId,
      key: WORKSPACE_KEY,
      value: workspace,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id,key" },
  );
}

function prospectKey(row: ProspectRow): string {
  return `${row.business_name || ""}|${row.address || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function mergeProspects(existing: ProspectRow[], incoming: ProspectRow[]): ProspectRow[] {
  const map = new Map<string, ProspectRow>();
  for (const row of existing) {
    const key = prospectKey(row);
    if (key) map.set(key, row);
  }
  for (const row of incoming) {
    const key = prospectKey(row);
    if (!key) continue;
    map.set(key, { ...(map.get(key) || {}), ...row });
  }
  return [...map.values()];
}

function makeTask(content: string, position: number): WorkspaceTask {
  return {
    id: `task_${position + 1}`,
    content,
    status: position === 0 ? "in_progress" : "pending",
    position,
    notes: null,
    updated_at: new Date().toISOString(),
  };
}

function resolveTask(tasks: WorkspaceTask[], raw: unknown): WorkspaceTask | null {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return null;
  const indexMatch = key.match(/^#?\s*(?:task\s*)?(\d{1,3})$/i);
  if (indexMatch) {
    const idx = parseInt(indexMatch[1], 10) - 1;
    return tasks.find((t) => t.position === idx) || null;
  }
  if (key === "current" || key === "in_progress") {
    return tasks.find((t) => t.status === "in_progress") || null;
  }
  if (key === "next") {
    return tasks.find((t) => t.status === "pending") || null;
  }
  return (
    tasks.find((t) => t.id.toLowerCase() === key) ||
    tasks.find((t) => t.content.toLowerCase().includes(key)) ||
    null
  );
}

function workspaceProgress(workspace: Awaited<ReturnType<typeof loadWorkspace>>) {
  const completeProspects = workspace.prospects.filter(
    (p) =>
      String(p.business_name || "").trim() &&
      String(p.data_provenance || "").trim().length >= 8 &&
      Boolean(String(p.phone || p.email || p.owner_phone || p.owner_email || "").trim()) &&
      Boolean(String(p.owner_name || p.siren || "").trim()),
  );
  return {
    total_prospects: workspace.prospects.length,
    complete_prospects: completeProspects.length,
    saved_prospects: workspace.prospects.filter((p) => p.saved || p.lead_id).length,
    rejected_count: workspace.rejected.length,
    exported_count: workspace.exported_count,
    open_tasks: workspace.tasks.filter((t) =>
      t.status === "pending" || t.status === "in_progress",
    ).length,
    tasks: workspace.tasks,
    blocker_summary: workspace.blocker_summary,
  };
}

async function resolveMissionIdForLead(
  db: SupabaseClient,
  candidate: string | undefined,
): Promise<string | null> {
  if (!candidate?.trim()) return null;
  const { data, error } = await db
    .from("missions")
    .select("id")
    .eq("id", candidate.trim())
    .maybeSingle();
  if (error || !data?.id) return null;
  return data.id;
}

function validateForSave(row: ProspectRow): string | null {
  const name = String(row.business_name || "").trim();
  const provenance = String(row.data_provenance || "").trim();
  const hasContact = Boolean(
    String(row.phone || row.email || row.owner_phone || row.owner_email || "").trim(),
  );
  const hasLegal = Boolean(String(row.owner_name || row.siren || "").trim());
  if (!name) return "missing business_name";
  if (!hasContact) return `${name}: missing verified phone or email`;
  if (!hasLegal) return `${name}: missing verified owner or SIREN`;
  if (provenance.length < 8) return `${name}: missing data_provenance`;
  return null;
}

async function saveRowsToCrm(
  rows: ProspectRow[],
  context: AgentContext,
): Promise<{ saved: ProspectRow[]; skipped: string[] }> {
  if (!context.sessionId) throw new Error("prospect_list.save requires sessionId");
  const db = getAgentDb();
  const missionFk = await resolveMissionIdForLead(db, context.missionId);
  let searchId = context.leadSearchId;
  if (!searchId) {
    searchId = await ensureAgentLeadSearchId({
      orgId: context.orgId,
      userId: context.userId,
      sessionId: context.sessionId,
      nicheHint: null,
      locationHint: null,
    });
    context.leadSearchId = searchId;
  }

  const optionalFields = [
    "address",
    "phone",
    "email",
    "website_url",
    "rating",
    "review_count",
    "owner_name",
    "owner_email",
    "owner_phone",
    "owner_role",
    "linkedin_url",
    "siren",
    "company_type",
    "creation_date",
    "employee_count",
    "revenue_bracket",
    "potential_score",
    "confidence_score",
    "notes",
  ] as const;

  const skipped: string[] = [];
  const insertRows: ProspectRow[] = [];

  for (const row of rows) {
    const invalid = validateForSave(row);
    if (invalid) {
      skipped.push(invalid);
      continue;
    }

    const leadData: ProspectRow = {
      business_name: String(row.business_name),
      org_id: context.orgId,
      user_id: context.userId,
      source: "lead-agent-v1",
      search_id: searchId,
      enrichment_data: {
        agent_session_id: context.sessionId,
        v1_sources: row.sources || null,
      },
    };
    if (missionFk) leadData.mission_id = missionFk;

    for (const field of optionalFields) {
      if (row[field] !== undefined && row[field] !== null) {
        leadData[field] = row[field];
      }
    }

    const provenance = String(row.data_provenance || "").trim();
    const notes = String(leadData.notes || "").trim();
    leadData.notes = notes
      ? `${notes}\n\n[Sources] ${provenance}`
      : `[Sources] ${provenance}`;
    if (leadData.website_url) leadData.has_website = true;
    insertRows.push(leadData);
  }

  if (insertRows.length === 0) return { saved: [], skipped };

  const { data, error } = await db
    .from("leads")
    .insert(insertRows)
    .select("id, business_name");
  if (error) throw new Error(`prospect_list save failed: ${error.message}`);

  return {
    saved: (data || []).map((r) => ({
      lead_id: r.id,
      business_name: r.business_name,
      action: "created",
    })),
    skipped,
  };
}

registerTool(
  {
    name: "prospect_list",
    description:
      "Session workspace, mandatory task state, prospect list, and CRM persistence. Actions: task_create, task_update, task_list, add, update, reject, list, save, export, blocker_summary, status. Create tasks before substantive multi-step work and update them when phases start/finish.",
    parameters: {
      action: {
        type: "string",
        description:
          "task_create | task_update | task_list | add | update | reject | list | save | export | blocker_summary | status",
        enum: [
          "task_create",
          "task_update",
          "task_list",
          "add",
          "update",
          "reject",
          "list",
          "save",
          "export",
          "blocker_summary",
          "status",
        ],
      },
      tasks: {
        type: "array",
        description:
          "task_create: ordered task descriptions. First task is set in_progress.",
        items: { type: "string" },
        required: false,
      },
      task_id: {
        type: "string",
        description:
          "task_update: task id, 1-based index, current, in_progress, next, or content substring",
        required: false,
      },
      status: {
        type: "string",
        description:
          "task_update: pending | in_progress | completed | blocked | cancelled",
        enum: ["pending", "in_progress", "completed", "blocked", "cancelled"],
        required: false,
      },
      notes: {
        type: "string",
        description: "task_update/status note",
        required: false,
      },
      target_count: {
        type: "number",
        description: "Optional user-requested target count for progress display",
        required: false,
      },
      prospects: {
        type: "array",
        description: "Prospect objects to add/update/save",
        items: { type: "object" },
        required: false,
      },
      rejected: {
        type: "array",
        description: "Rejected prospect objects with reason",
        items: { type: "object" },
        required: false,
      },
      business_name: {
        type: "string",
        description: "Single business name for update/reject",
        required: false,
      },
      reason: {
        type: "string",
        description: "Reject reason",
        required: false,
      },
      summary: {
        type: "string",
        description:
          "blocker_summary: explicit explanation when the requested deliverable cannot be completed honestly",
        required: false,
      },
    },
    required: ["action"],
    costEstimateCents: 0,
  },
  async (args, context: AgentContext) => {
    if (!context.sessionId) throw new Error("prospect_list requires sessionId");
    const action = String(args.action || "").toLowerCase();
    const workspace = await loadWorkspace(context.sessionId);

    if (action === "task_create") {
      const rawTasks = Array.isArray(args.tasks) ? args.tasks : [];
      const tasks = rawTasks
        .map((t) => String(t || "").trim())
        .filter(Boolean)
        .map(makeTask);
      if (tasks.length === 0) {
        throw new Error("prospect_list.task_create requires tasks[]");
      }
      workspace.tasks = tasks;
      workspace.blocker_summary = null;
      await saveWorkspace(context.sessionId, workspace);
      return {
        ok: true,
        tasks: workspace.tasks,
        progress: workspaceProgress(workspace),
      };
    }

    if (action === "task_update") {
      const task = resolveTask(workspace.tasks, args.task_id || "current");
      if (!task) {
        throw new Error(
          `prospect_list.task_update: no matching task for "${String(args.task_id || "current")}"`,
        );
      }
      const status = String(args.status || "").trim() as TaskStatus;
      if (!["pending", "in_progress", "completed", "blocked", "cancelled"].includes(status)) {
        throw new Error("prospect_list.task_update requires valid status");
      }
      workspace.tasks = workspace.tasks.map((t) =>
        t.id === task.id
          ? {
              ...t,
              status,
              notes: String(args.notes || t.notes || "").trim() || null,
              updated_at: new Date().toISOString(),
            }
          : t,
      );
      await saveWorkspace(context.sessionId, workspace);
      return {
        ok: true,
        tasks: workspace.tasks,
        progress: workspaceProgress(workspace),
      };
    }

    if (action === "task_list" || action === "status") {
      return {
        tasks: workspace.tasks,
        prospects: workspace.prospects,
        rejected: workspace.rejected,
        progress: workspaceProgress(workspace),
      };
    }

    if (action === "add" || action === "update") {
      const incoming = Array.isArray(args.prospects)
        ? (args.prospects as ProspectRow[])
        : [];
      workspace.prospects = mergeProspects(workspace.prospects, incoming);
      await saveWorkspace(context.sessionId, workspace);
      return {
        count: workspace.prospects.length,
        prospects: workspace.prospects,
        rejected_count: workspace.rejected.length,
        progress: workspaceProgress(workspace),
      };
    }

    if (action === "reject") {
      const rejected = Array.isArray(args.rejected)
        ? (args.rejected as ProspectRow[])
        : [
            {
              business_name: args.business_name,
              reason: args.reason || "rejected",
            },
          ];
      workspace.rejected = [...workspace.rejected, ...rejected];
      const rejectedKeys = new Set(rejected.map(prospectKey));
      workspace.prospects = workspace.prospects.filter(
        (p) => !rejectedKeys.has(prospectKey(p)),
      );
      await saveWorkspace(context.sessionId, workspace);
      return {
        count: workspace.prospects.length,
        rejected_count: workspace.rejected.length,
        rejected,
        progress: workspaceProgress(workspace),
      };
    }

    if (action === "save") {
      const rows = Array.isArray(args.prospects)
        ? (args.prospects as ProspectRow[])
        : workspace.prospects;
      const result = await saveRowsToCrm(rows, context);
      await saveWorkspace(context.sessionId, {
        ...workspace,
        prospects: workspace.prospects.map((p) => {
          const saved = result.saved.find(
            (s) => String(s.business_name) === String(p.business_name),
          );
          return saved ? { ...p, lead_id: saved.lead_id, saved: true } : p;
        }),
      });
      return result;
    }

    if (action === "export") {
      workspace.exported_at = new Date().toISOString();
      workspace.exported_count = workspace.prospects.length;
      await saveWorkspace(context.sessionId, workspace);
      return {
        prospects: workspace.prospects,
        rejected: workspace.rejected,
        progress: workspaceProgress(workspace),
        csv: toCsv(workspace.prospects),
      };
    }

    if (action === "blocker_summary") {
      const summary = String(args.summary || args.reason || "").trim();
      if (summary.length < 20) {
        throw new Error("prospect_list.blocker_summary requires a specific summary");
      }
      workspace.blocker_summary = summary;
      await saveWorkspace(context.sessionId, workspace);
      return {
        ok: true,
        blocker_summary: summary,
        progress: workspaceProgress(workspace),
      };
    }

    if (action === "list") {
      return {
        count: workspace.prospects.length,
        prospects: workspace.prospects,
        rejected_count: workspace.rejected.length,
        rejected: workspace.rejected,
        progress: workspaceProgress(workspace),
      };
    }

    throw new Error(`Unknown prospect_list action: ${action}`);
  },
);

function toCsv(rows: ProspectRow[]): string {
  const columns = [
    "business_name",
    "address",
    "phone",
    "email",
    "website_url",
    "owner_name",
    "owner_role",
    "siren",
    "confidence_score",
    "notes",
    "data_provenance",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [columns.join(","), ...rows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
}
