/**
 * Insert multiple leads in one round-trip (same semantics as `save_lead`).
 * Prefer when you have several qualified rows ready — saves iterations vs N× save_lead.
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";
import { resolveMissionIdForLead } from "./save-lead";
import { ensureAgentLeadSearchId } from "../lead-search-stub";

const MAX_BATCH = 25;

type LeadInput = Record<string, unknown>;

registerTool(
  {
    name: "batch_save_leads",
    description:
      "Create up to 25 leads in one DB insert. Same fields as `save_lead` per row (business_name required each). Skips rows missing business_name. All rows share the session stub `search_id` and get enrichment_data.agent_session_id for deliverable counting. If you pass more than 25 rows, only the first 25 are processed — split into multiple calls.",
    parameters: {
      leads: {
        type: "array",
        description: "Array of lead objects (same shape as save_lead args minus lead_id)",
        items: { type: "object" },
      },
    },
    required: ["leads"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const raw = args.leads as unknown;
    if (!Array.isArray(raw)) throw new Error("leads must be an array");
    if (!context.sessionId) throw new Error("batch_save_leads requires a session");

    const db = getAgentDb();
    const missionFk = await resolveMissionIdForLead(db, context.missionId);

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
      "notes",
      "confidence_score",
      "website_presence",
      "data_provenance",
    ] as const;

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

    const rows: Record<string, unknown>[] = [];
    const skipped: string[] = [];

    for (const item of raw.slice(0, MAX_BATCH)) {
      if (!item || typeof item !== "object") {
        skipped.push("(invalid entry)");
        continue;
      }
      const row = item as LeadInput;
      const name = String(row.business_name || "").trim();
      if (!name) {
        skipped.push("(missing business_name)");
        continue;
      }

      if (context.capabilityPacks?.includes("lead-gen-fr")) {
        const phone = String(row.phone || "").trim();
        const email = String(row.email || "").trim();
        const op = String(row.owner_phone || "").trim();
        const oe = String(row.owner_email || "").trim();
        const owner = String(row.owner_name || "").trim();
        const prov = String(row.data_provenance || "").trim();
        const siren = String(row.siren || "").trim();
        const hasContact =
          phone.length > 0 || email.length > 0 || op.length > 0 || oe.length > 0;
        const hasOwnerOrLegal = owner.length > 0 || siren.length > 0;
        if (!hasContact || !hasOwnerOrLegal || prov.length < 8) {
          skipped.push(`${name} (lead-gen: contact+dirigeant/SIREN+provenance requis)`);
          continue;
        }
      }

      const enrichment: Record<string, unknown> = {
        agent_session_id: context.sessionId,
      };
      const wp = row.website_presence;
      if (typeof wp === "string" && wp.trim()) {
        enrichment.website_presence = wp.trim();
      }

      const leadData: Record<string, unknown> = {
        business_name: name,
        org_id: context.orgId,
        user_id: context.userId,
        source: "lead-agent-v2",
        search_id: searchId,
        enrichment_data: enrichment,
      };
      if (missionFk) leadData.mission_id = missionFk;

      for (const field of optionalFields) {
        if (field === "website_presence") continue;
        if (field === "data_provenance") continue;
        if (row[field] !== undefined && row[field] !== null) {
          leadData[field] = row[field];
        }
      }
      const prov = String(row.data_provenance || "").trim();
      if (prov) {
        const prevNotes = String(leadData.notes || "").trim();
        leadData.notes = prevNotes
          ? `${prevNotes}\n\n[Sources] ${prov}`
          : `[Sources] ${prov}`;
      }
      if (leadData.website_url) leadData.has_website = true;
      rows.push(leadData);
    }

    if (rows.length === 0) {
      return { saved: [], count: 0, skipped, error: "no valid rows to insert" };
    }

    const { data, error } = await db.from("leads").insert(rows).select("id, business_name");
    if (error) throw new Error(`batch_save_leads failed: ${error.message}`);

    const saved = (data || []).map((r) => ({
      lead_id: r.id as string,
      business_name: r.business_name as string,
      action: "created" as const,
    }));

    return { saved, count: saved.length, skipped };
  },
);
