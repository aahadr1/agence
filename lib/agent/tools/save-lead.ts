import { registerTool } from "../tool-registry";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Only set leads.mission_id when candidate exists in public.missions (FK-safe). */
export async function resolveMissionIdForLead(
  db: ReturnType<typeof getServiceClient>,
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

registerTool(
  {
    name: "save_lead",
    description:
      "Save or update a lead in the database. Provide all known fields. Returns the lead ID. If lead_id is provided, updates the existing lead.",
    parameters: {
      lead_id: { type: "string", description: "Existing lead ID to update (optional)", required: false },
      business_name: { type: "string", description: "Business name" },
      address: { type: "string", description: "Business address", required: false },
      phone: { type: "string", description: "Business phone", required: false },
      email: { type: "string", description: "Business email", required: false },
      website_url: { type: "string", description: "Website URL", required: false },
      rating: { type: "string", description: "Google rating", required: false },
      review_count: { type: "string", description: "Number of reviews", required: false },
      owner_name: { type: "string", description: "Owner/decision-maker full name", required: false },
      owner_email: { type: "string", description: "Owner email (verified)", required: false },
      owner_phone: { type: "string", description: "Owner direct phone", required: false },
      owner_role: { type: "string", description: "Owner role (Gerant, PDG...)", required: false },
      linkedin_url: { type: "string", description: "Owner LinkedIn URL", required: false },
      siren: { type: "string", description: "SIREN/SIRET", required: false },
      company_type: { type: "string", description: "Legal form", required: false },
      creation_date: { type: "string", description: "Company creation date", required: false },
      employee_count: { type: "string", description: "Employee count", required: false },
      revenue_bracket: { type: "string", description: "Revenue bracket", required: false },
      potential_score: { type: "number", description: "Score 0-100", required: false },
      confidence_score: { type: "number", description: "Data confidence 0-100", required: false },
      notes: { type: "string", description: "Agent notes about this lead", required: false },
    },
    required: ["business_name"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getServiceClient();

    const leadData: Record<string, unknown> = {
      business_name: args.business_name,
      org_id: context.orgId,
      user_id: context.userId,
      source: "lead-agent-v2",
    };

    const missionFk = await resolveMissionIdForLead(db, context.missionId);
    if (missionFk) {
      leadData.mission_id = missionFk;
    }

    const optionalFields = [
      "address", "phone", "email", "website_url", "rating", "review_count",
      "owner_name", "owner_email", "owner_phone", "owner_role", "linkedin_url",
      "siren", "company_type", "creation_date", "employee_count", "revenue_bracket",
      "potential_score", "notes",
    ];

    for (const field of optionalFields) {
      if (args[field] !== undefined && args[field] !== null) {
        leadData[field] = args[field];
      }
    }

    if (args.website_url) leadData.has_website = true;

    if (!args.lead_id && context.sessionId) {
      leadData.enrichment_data = { agent_session_id: context.sessionId };
    }

    if (args.lead_id) {
      const { data, error } = await db
        .from("leads")
        .update(leadData)
        .eq("id", args.lead_id)
        .select("id")
        .single();
      if (error) throw new Error(`Update failed: ${error.message}`);
      return { lead_id: data.id, action: "updated" };
    }

    const { data, error } = await db
      .from("leads")
      .insert(leadData)
      .select("id")
      .single();
    if (error) throw new Error(`Insert failed: ${error.message}`);
    return { lead_id: data.id, action: "created" };
  }
);
