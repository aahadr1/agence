import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import type {
  CrmActivityType,
  CrmOpportunityStatus,
  CrmTaskPriority,
  CrmTaskStatus,
} from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolveCrmOrgId(client: SupabaseClient, userId: string) {
  return resolveOrgIdForUser(client, userId);
}

export async function getDefaultPipeline(client: SupabaseClient, orgId: string) {
  const { data: pipeline } = await client
    .from("crm_pipelines_v2")
    .select("id,name,is_default")
    .eq("org_id", orgId)
    .eq("is_default", true)
    .maybeSingle();

  if (pipeline) return pipeline;

  const { data: fallback } = await client
    .from("crm_pipelines_v2")
    .select("id,name,is_default")
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle();

  return fallback ?? null;
}

export async function ensureCrmPipelineForOrg(
  client: SupabaseClient,
  orgId: string
) {
  const existing = await getDefaultPipeline(client, orgId);
  if (existing) return existing;

  const { data: created, error } = await client
    .from("crm_pipelines_v2")
    .insert({
      org_id: orgId,
      name: "Agency Pipeline",
      is_default: true,
    })
    .select("id,name,is_default")
    .single();

  if (error || !created) {
    throw new Error(error?.message || "Unable to create default pipeline");
  }

  await client.from("crm_stages_v2").insert([
    { pipeline_id: created.id, name: "New prospect", sort_order: 0, color: "#64748b" },
    { pipeline_id: created.id, name: "Discovery", sort_order: 1, color: "#38bdf8" },
    { pipeline_id: created.id, name: "Qualification", sort_order: 2, color: "#a78bfa" },
    { pipeline_id: created.id, name: "Proposal sent", sort_order: 3, color: "#f59e0b" },
    { pipeline_id: created.id, name: "Negotiation", sort_order: 4, color: "#f97316" },
    {
      pipeline_id: created.id,
      name: "Won",
      sort_order: 5,
      color: "#22c55e",
      is_closed_won: true,
    },
    {
      pipeline_id: created.id,
      name: "Lost",
      sort_order: 6,
      color: "#ef4444",
      is_closed_lost: true,
    },
  ]);

  return created;
}

export async function createOpportunityFromLeadV2(
  client: SupabaseClient,
  params: { userId: string; orgId: string; leadId: string }
) {
  const { userId, orgId, leadId } = params;
  const { data: existing } = await client
    .from("crm_opportunities")
    .select("id")
    .eq("org_id", orgId)
    .eq("legacy_deal_id", leadId)
    .maybeSingle();

  if (existing) {
    return { id: existing.id, existing: true as const };
  }

  const { data: lead, error: leadErr } = await client
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();
  if (leadErr || !lead) throw new Error("Lead not found");

  const pipeline = await ensureCrmPipelineForOrg(client, orgId);
  const { data: firstStage } = await client
    .from("crm_stages_v2")
    .select("*")
    .eq("pipeline_id", pipeline.id)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStage) throw new Error("No CRM stages in default pipeline");

  const { data: account } = await client
    .from("crm_accounts")
    .insert({
      org_id: orgId,
      name: lead.business_name,
      website_url: lead.website_url || null,
      phone: lead.owner_phone || lead.phone || null,
      email: lead.owner_email || lead.email || null,
      address: lead.address || null,
      niche: lead.niche || null,
      source: "lead_generator",
      owner_user_id: userId,
      created_by: userId,
      legacy_lead_id: lead.id,
    })
    .select("id")
    .single();

  const { data: contact } = await client
    .from("crm_contacts")
    .insert({
      org_id: orgId,
      account_id: account?.id || null,
      full_name: lead.owner_name || lead.business_name,
      role: lead.owner_role || null,
      phone: lead.owner_phone || lead.phone || null,
      email: lead.owner_email || lead.email || null,
      linkedin_url: lead.linkedin_url || null,
      owner_user_id: userId,
      created_by: userId,
      legacy_lead_id: lead.id,
    })
    .select("id")
    .single();

  const { data: opportunity, error: oppErr } = await client
    .from("crm_opportunities")
    .insert({
      org_id: orgId,
      pipeline_id: pipeline.id,
      stage_id: firstStage.id,
      account_id: account?.id || null,
      primary_contact_id: contact?.id || null,
      title: lead.business_name,
      description: lead.description || null,
      owner_user_id: userId,
      source: "lead_generator",
      created_by: userId,
      legacy_deal_id: lead.id,
    })
    .select("*")
    .single();

  if (oppErr || !opportunity) {
    throw new Error(oppErr?.message || "Unable to create opportunity");
  }

  await client.from("crm_opportunity_stage_history").insert({
    org_id: orgId,
    opportunity_id: opportunity.id,
    pipeline_id: pipeline.id,
    from_stage_id: null,
    to_stage_id: firstStage.id,
    changed_by: userId,
  });

  await client.from("crm_activities").insert({
    org_id: orgId,
    opportunity_id: opportunity.id,
    account_id: account?.id || null,
    contact_id: contact?.id || null,
    type: "system",
    body: "Opportunity created from lead generator",
    metadata: { lead_id: lead.id },
    created_by: userId,
  });

  return { id: opportunity.id, existing: false as const };
}

export function parseOpportunityStatus(value: unknown): CrmOpportunityStatus | null {
  if (value === "open" || value === "won" || value === "lost" || value === "archived") {
    return value;
  }
  return null;
}

export function parseTaskStatus(value: unknown): CrmTaskStatus | null {
  if (value === "todo" || value === "in_progress" || value === "done" || value === "cancelled") {
    return value;
  }
  return null;
}

export function parseTaskPriority(value: unknown): CrmTaskPriority | null {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return null;
}

export function parseActivityType(value: unknown): CrmActivityType | null {
  if (
    value === "note" ||
    value === "call" ||
    value === "meeting" ||
    value === "email" ||
    value === "system" ||
    value === "stage_change"
  ) {
    return value;
  }
  return null;
}
