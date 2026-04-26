import type { SupabaseClient } from "@supabase/supabase-js";
import { registerTool } from "../tool-registry";
import type { AgentContext } from "../types";
import { ensureAgentLeadSearchId } from "../lead-search-stub";
import { getAgentDb } from "./_db";

type ProspectRow = Record<string, unknown>;

const WORKSPACE_KEY = "v1_prospect_workspace";

async function loadWorkspace(sessionId: string): Promise<{
  prospects: ProspectRow[];
  rejected: ProspectRow[];
}> {
  const db = getAgentDb();
  const { data } = await db
    .from("agent_memory")
    .select("value")
    .eq("session_id", sessionId)
    .eq("key", WORKSPACE_KEY)
    .maybeSingle();
  const value = data?.value as
    | { prospects?: ProspectRow[]; rejected?: ProspectRow[] }
    | undefined;
  return {
    prospects: Array.isArray(value?.prospects) ? value.prospects : [],
    rejected: Array.isArray(value?.rejected) ? value.rejected : [],
  };
}

async function saveWorkspace(
  sessionId: string,
  workspace: { prospects: ProspectRow[]; rejected: ProspectRow[] },
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
      "Session prospect workspace and CRM persistence. Actions: add, update, reject, list, save, export. Stores provenance and saves verified prospects to CRM.",
    parameters: {
      action: {
        type: "string",
        description: "add | update | reject | list | save | export",
        enum: ["add", "update", "reject", "list", "save", "export"],
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
    },
    required: ["action"],
    costEstimateCents: 0,
  },
  async (args, context: AgentContext) => {
    if (!context.sessionId) throw new Error("prospect_list requires sessionId");
    const action = String(args.action || "").toLowerCase();
    const workspace = await loadWorkspace(context.sessionId);

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
      return {
        prospects: workspace.prospects,
        rejected: workspace.rejected,
        csv: toCsv(workspace.prospects),
      };
    }

    if (action === "list") {
      return {
        count: workspace.prospects.length,
        prospects: workspace.prospects,
        rejected_count: workspace.rejected.length,
        rejected: workspace.rejected,
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
