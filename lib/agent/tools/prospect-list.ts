import type { SupabaseClient } from "@supabase/supabase-js";
import { registerTool } from "../tool-registry";
import type { AgentContext } from "../types";
import { ensureAgentLeadSearchId } from "../lead-search-stub";
import { getAgentDb } from "./_db";

type ProspectRow = Record<string, unknown>;
type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
type ProspectStatus =
  | "discovered"
  | "legal_found"
  | "contact_found"
  | "complete"
  | "saved"
  | "rejected"
  | "needs_review";
type WorkspaceTask = {
  id: string;
  content: string;
  status: TaskStatus;
  position: number;
  notes?: string | null;
  updated_at: string;
};
type Workspace = {
  prospects: ProspectRow[];
  rejected: ProspectRow[];
  tasks: WorkspaceTask[];
  objective: string | null;
  target_count: number | null;
  acceptance_criteria: string | null;
  contact_policy: string;
  blocker_summary: string | null;
  terminal_blocked: boolean;
  exported_at: string | null;
  exported_count: number;
};

const WORKSPACE_KEY = "v1_prospect_workspace";
const DEFAULT_CONTACT_POLICY =
  "Establishment phone or establishment email counts as contact unless the user explicitly asks for owner-direct contact.";

async function loadWorkspace(sessionId: string): Promise<Workspace> {
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
        objective?: string | null;
        target_count?: number | null;
        acceptance_criteria?: string | null;
        contact_policy?: string | null;
        blocker_summary?: string | null;
        terminal_blocked?: boolean;
        exported_at?: string | null;
        exported_count?: number;
      }
    | undefined;
  return {
    prospects: Array.isArray(value?.prospects) ? value.prospects : [],
    rejected: Array.isArray(value?.rejected) ? value.rejected : [],
    tasks: Array.isArray(value?.tasks) ? value.tasks : [],
    objective: typeof value?.objective === "string" ? value.objective : null,
    target_count:
      typeof value?.target_count === "number" && Number.isFinite(value.target_count)
        ? value.target_count
        : null,
    acceptance_criteria:
      typeof value?.acceptance_criteria === "string"
        ? value.acceptance_criteria
        : null,
    contact_policy:
      typeof value?.contact_policy === "string" && value.contact_policy.trim()
        ? value.contact_policy
        : DEFAULT_CONTACT_POLICY,
    blocker_summary:
      typeof value?.blocker_summary === "string" ? value.blocker_summary : null,
    terminal_blocked: value?.terminal_blocked === true,
    exported_at: typeof value?.exported_at === "string" ? value.exported_at : null,
    exported_count:
      typeof value?.exported_count === "number" ? value.exported_count : 0,
  };
}

async function saveWorkspace(
  sessionId: string,
  workspace: Workspace,
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
  return `${row.business_name || row.name || ""}|${row.address || row.location || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasContact(row: ProspectRow): boolean {
  return Boolean(
    String(row.phone || row.email || row.owner_phone || row.owner_email || "").trim(),
  );
}

function hasLegalIdentity(row: ProspectRow): boolean {
  return Boolean(String(row.owner_name || row.siren || row.siret || "").trim());
}

function hasProvenance(row: ProspectRow): boolean {
  return String(row.data_provenance || "").trim().length >= 8 ||
    (Array.isArray(row.sources) && row.sources.length > 0);
}

function inferProspectStatus(row: ProspectRow): ProspectStatus {
  if (row.saved || row.lead_id) return "saved";
  if (row.status === "rejected") return "rejected";
  if (row.status === "needs_review") return "needs_review";
  if (Array.isArray(row.rejected_reasons) && row.rejected_reasons.length > 0) {
    return "needs_review";
  }
  const contact = hasContact(row);
  const legal = hasLegalIdentity(row);
  if (contact && legal && hasProvenance(row)) return "complete";
  if (contact && legal) return "needs_review";
  if (legal) return "legal_found";
  if (contact) return "contact_found";
  return "discovered";
}

function isCompleteProspect(row: ProspectRow): boolean {
  return (
    String(row.business_name || "").trim().length > 0 &&
    hasContact(row) &&
    hasLegalIdentity(row) &&
    hasProvenance(row) &&
    String(row.status || "") !== "rejected"
  );
}

function mergeSources(a: unknown, b: unknown): unknown {
  if (!Array.isArray(a) && !Array.isArray(b)) return b ?? a;
  const all = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  const seen = new Set<string>();
  return all.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRejectedCandidate(row: ProspectRow, rejected: ProspectRow[]): boolean {
  const name = normalizeLoose(row.business_name || row.name);
  const address = normalizeLoose(row.address || row.location);
  const siren = normalizeLoose(row.siren || row.siret);
  const maps = normalizeLoose(row.google_maps_url);
  if (!name && !siren && !maps) return false;
  return rejected.some((r) => {
    const rName = normalizeLoose(r.business_name || r.name);
    const rAddress = normalizeLoose(r.address || r.location);
    const rSiren = normalizeLoose(r.siren || r.siret);
    const rMaps = normalizeLoose(r.google_maps_url);
    if (siren && rSiren && siren === rSiren) return true;
    if (maps && rMaps && maps === rMaps) return true;
    if (!name || !rName || name !== rName) return false;
    if (!address || !rAddress) return true;
    return address === rAddress;
  });
}

function mergeProspects(
  existing: ProspectRow[],
  incoming: ProspectRow[],
  rejected: ProspectRow[],
): { prospects: ProspectRow[]; skipped_rejected: ProspectRow[] } {
  const map = new Map<string, ProspectRow>();
  for (const row of existing) {
    const key = prospectKey(row);
    if (key) map.set(key, { ...row, status: inferProspectStatus(row) });
  }
  const skipped_rejected: ProspectRow[] = [];
  for (const row of incoming) {
    const key = prospectKey(row);
    if (!key) continue;
    if (isRejectedCandidate(row, rejected) && row.reconsider !== true) {
      skipped_rejected.push(row);
      continue;
    }
    const prev = map.get(key) || {};
    const merged = {
      ...prev,
      ...row,
      sources: mergeSources(prev.sources, row.sources),
      updated_at: new Date().toISOString(),
    };
    const statusProbe = row.status ? merged : { ...merged, status: undefined };
    map.set(key, { ...merged, status: inferProspectStatus(statusProbe) });
  }
  return { prospects: [...map.values()], skipped_rejected };
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

function workspaceProgress(workspace: Workspace) {
  const normalized = workspace.prospects.map((p) => ({
    ...p,
    status: inferProspectStatus(p),
  }));
  const completeProspects = normalized.filter(isCompleteProspect);
  const target = workspace.target_count;
  const statusCounts = normalized.reduce<Record<string, number>>((acc, row) => {
    const status = String(row.status || "discovered");
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  return {
    objective: workspace.objective,
    target_count: target,
    acceptance_criteria: workspace.acceptance_criteria,
    contact_policy: workspace.contact_policy,
    total_prospects: workspace.prospects.length,
    complete_count: completeProspects.length,
    complete_prospects: completeProspects.length,
    partial_count: normalized.length - completeProspects.length,
    saved_prospects: workspace.prospects.filter((p) => p.saved || p.lead_id).length,
    rejected_count: workspace.rejected.length,
    status_counts: statusCounts,
    remaining_needed:
      typeof target === "number" ? Math.max(0, target - completeProspects.length) : null,
    exported_count: workspace.exported_count,
    open_tasks: workspace.tasks.filter((t) =>
      t.status === "pending" || t.status === "in_progress",
    ).length,
    tasks: workspace.tasks,
    blocker_summary: workspace.blocker_summary,
    terminal_blocked: workspace.terminal_blocked,
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
  if (!name) return "missing business_name";
  if (!hasContact(row)) return `${name}: missing verified phone or email`;
  if (!hasLegalIdentity(row)) return `${name}: missing verified owner or SIREN`;
  if (!hasProvenance(row)) return `${name}: missing data_provenance or sources`;
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
      objective: {
        type: "string",
        description: "task_create/status: concise user objective being pursued",
        required: false,
      },
      acceptance_criteria: {
        type: "string",
        description:
          "What makes a row usable, e.g. 10 restaurants in Nancy with dirigeant plus establishment phone/email",
        required: false,
      },
      contact_policy: {
        type: "string",
        description:
          "Clarify contact definition. Default: establishment phone/email counts unless owner-direct was requested.",
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
      workspace.objective = String(args.objective || workspace.objective || "").trim() || null;
      workspace.target_count =
        Number.isFinite(Number(args.target_count)) && Number(args.target_count) > 0
          ? Number(args.target_count)
          : workspace.target_count;
      workspace.acceptance_criteria =
        String(args.acceptance_criteria || workspace.acceptance_criteria || "").trim() ||
        null;
      workspace.contact_policy =
        String(args.contact_policy || workspace.contact_policy || "").trim() ||
        DEFAULT_CONTACT_POLICY;
      workspace.blocker_summary = null;
      workspace.terminal_blocked = false;
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
          : status === "in_progress" && t.status === "in_progress"
            ? {
                ...t,
                status: "pending",
                updated_at: new Date().toISOString(),
              }
            : t,
      );
      await saveWorkspace(context.sessionId, workspace);
      return {
        ok: true,
        tasks: workspace.tasks,
        progress: workspaceProgress(workspace),
        guidance:
          status === "completed"
            ? "If a next phase is starting, call prospect_list task_update with task_id=\"next\" status=\"in_progress\" before the next substantive tool."
            : null,
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
      const merged = mergeProspects(workspace.prospects, incoming, workspace.rejected);
      workspace.prospects = merged.prospects;
      workspace.blocker_summary = null;
      workspace.terminal_blocked = false;
      await saveWorkspace(context.sessionId, workspace);
      return {
        count: workspace.prospects.length,
        prospects: workspace.prospects,
        rejected_count: workspace.rejected.length,
        skipped_rejected: merged.skipped_rejected,
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
      const stampedRejected: ProspectRow[] = rejected.map((r) => ({
        ...r,
        status: "rejected",
        rejected_at: new Date().toISOString(),
        reason: r.reason || args.reason || "rejected",
      }));
      const rejectionMap = new Map<string, ProspectRow>();
      for (const row of workspace.rejected) {
        const key = prospectKey(row) || normalizeLoose(row.business_name || row.name);
        if (key) rejectionMap.set(key, { ...row, status: "rejected" });
      }
      for (const row of stampedRejected) {
        const key = prospectKey(row) || normalizeLoose(row.business_name || row.name);
        if (key) rejectionMap.set(key, row);
      }
      workspace.rejected = [...rejectionMap.values()];
      const rejectedKeys = new Set(rejected.map(prospectKey));
      workspace.prospects = workspace.prospects.filter(
        (p) =>
          !rejectedKeys.has(prospectKey(p)) &&
          !isRejectedCandidate(p, stampedRejected),
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
          const merged = saved ? { ...p, lead_id: saved.lead_id, saved: true } : p;
          return { ...merged, status: inferProspectStatus(merged) };
        }),
      });
      return result;
    }

    if (action === "export") {
      workspace.exported_at = new Date().toISOString();
      const complete = workspace.prospects
        .map((p) => ({ ...p, status: inferProspectStatus(p) }))
        .filter(isCompleteProspect);
      workspace.prospects = workspace.prospects.map((p) => ({
        ...p,
        status: inferProspectStatus(p),
      }));
      workspace.exported_count = complete.length;
      await saveWorkspace(context.sessionId, workspace);
      return {
        prospects: complete,
        rejected: workspace.rejected,
        progress: workspaceProgress(workspace),
        csv: toCsv(complete),
      };
    }

    if (action === "blocker_summary") {
      const summary = String(args.summary || args.reason || "").trim();
      if (summary.length < 40) {
        throw new Error("prospect_list.blocker_summary requires a specific summary");
      }
      workspace.blocker_summary = summary;
      workspace.terminal_blocked = true;
      workspace.tasks = workspace.tasks.map((t) =>
        t.status === "pending" || t.status === "in_progress"
          ? {
              ...t,
              status: "blocked",
              notes: summary.slice(0, 500),
              updated_at: new Date().toISOString(),
            }
          : t,
      );
      await saveWorkspace(context.sessionId, workspace);
      return {
        ok: true,
        blocker_summary: summary,
        progress: workspaceProgress(workspace),
        guidance:
          "Terminal blocker recorded. Stop searching now and deliver the verified rows plus exact blocker/rejection summary unless the user changes scope.",
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
