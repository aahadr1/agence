import type { SupabaseClient } from "@supabase/supabase-js";
import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";
import { ensureAgentLeadSearchId } from "../lead-search-stub";

/** Only set leads.mission_id when candidate exists in public.missions (FK-safe). */
export async function resolveMissionIdForLead(
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
      website_presence: {
        type: "string",
        description:
          "Optional: Maps vs site reality — one of maps_claim_no_site | finder_verified | contradiction | unknown",
        required: false,
      },
      notes: { type: "string", description: "Agent notes about this lead", required: false },
      data_provenance: {
        type: "string",
        description:
          "Optional: where each key fact came from (e.g. « dirigeant : Societe.com | tel établissement : Maps »). Appended to notes for audit.",
        required: false,
      },
    },
    required: ["business_name"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();

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
      "potential_score", "confidence_score", "notes",
    ];

    for (const field of optionalFields) {
      if (args[field] !== undefined && args[field] !== null) {
        leadData[field] = args[field];
      }
    }

    const prov = String(args.data_provenance || "").trim();
    if (prov) {
      const prevNotes = String(leadData.notes || "").trim();
      leadData.notes = prevNotes
        ? `${prevNotes}\n\n[Sources] ${prov}`
        : `[Sources] ${prov}`;
    }

    if (args.website_url) leadData.has_website = true;

    if (!args.lead_id && context.sessionId) {
      const enrichment: Record<string, unknown> = {
        agent_session_id: context.sessionId,
      };
      const wp = String(args.website_presence || "").trim();
      if (wp) enrichment.website_presence = wp;
      leadData.enrichment_data = enrichment;
    }

    if (
      !args.lead_id &&
      context.capabilityPacks?.includes("lead-gen-fr")
    ) {
      const phone = String(args.phone || "").trim();
      const email = String(args.email || "").trim();
      const op = String(args.owner_phone || "").trim();
      const oe = String(args.owner_email || "").trim();
      const owner = String(args.owner_name || "").trim();
      const prov = String(args.data_provenance || "").trim();
      const siren = String(args.siren || "").trim();
      const hasContact =
        phone.length > 0 || email.length > 0 || op.length > 0 || oe.length > 0;
      const hasOwnerOrLegal = owner.length > 0 || siren.length > 0;
      if (!hasContact || !hasOwnerOrLegal || prov.length < 8) {
        throw new Error(
          "save_lead (lead-gen-fr) : fiche refusée — il faut au minimum : " +
            "(1) un **contact** (téléphone ou email établissement ou dirigeant), " +
            "(2) **dirigeant** (owner_name) **ou** SIREN vérifiable, " +
            "(3) **data_provenance** (≥8 caractères) indiquant la source des faits. " +
            "Complète puis réessaie.",
        );
      }
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

    if (!context.sessionId) {
      throw new Error(
        "save_lead (création) requiert une session agent active (sessionId).",
      );
    }
    let searchId = context.leadSearchId;
    if (!searchId) {
      searchId = await ensureAgentLeadSearchId({
        orgId: context.orgId,
        userId: context.userId,
        sessionId: context.sessionId,
        nicheHint: null,
        locationHint: (args.address as string) || null,
      });
      context.leadSearchId = searchId;
    }
    leadData.search_id = searchId;

    const { data, error } = await db
      .from("leads")
      .insert(leadData)
      .select("id")
      .single();
    if (error) throw new Error(`Insert failed: ${error.message}`);
    return { lead_id: data.id, action: "created" };
  }
);
