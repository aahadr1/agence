import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  runEnrichmentPhaseA,
  runEnrichmentPhaseB,
  type LeadResult,
} from "@/lib/lead-agent";
import { computeLeadScore, generateSalesBrief } from "@/lib/lead-agent/enrichment/lead-scorer";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  const logs: string[] = [];
  const log = (msg: string) => {
    logs.push(msg);
    console.log(msg);
  };

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leadId } = await request.json();
    if (!leadId) {
      return NextResponse.json(
        { error: "leadId is required" },
        { status: 400 }
      );
    }

    const serviceClient = await createServiceClient();

    const { data: dbLead } = await serviceClient
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (!dbLead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Verify the lead belongs to the caller's org
    const orgId = await resolveOrgIdForUser(serviceClient, user.id);
    if (dbLead.org_id && dbLead.org_id !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (dbLead.enrichment_status === "completed") {
      return NextResponse.json({ lead: dbLead, skipped: true });
    }

    await serviceClient
      .from("leads")
      .update({ enrichment_status: "enriching" })
      .eq("id", leadId);

    const leadInput: LeadResult = {
      business_name: dbLead.business_name,
      description: dbLead.description,
      address: dbLead.address,
      phone: dbLead.phone,
      email: dbLead.email,
      rating: dbLead.rating,
      review_count: dbLead.review_count,
      review_highlights: dbLead.review_highlights || [],
      has_website: dbLead.has_website ?? false,
      website_url: dbLead.website_url,
      google_maps_url: dbLead.google_maps_url,
      facebook_url: dbLead.facebook_url,
      instagram_url: dbLead.instagram_url,
      owner_name: dbLead.owner_name,
      owner_phone: dbLead.owner_phone,
      owner_email: dbLead.owner_email,
      owner_role: dbLead.owner_role,
      linkedin_url: dbLead.linkedin_url,
      siren: dbLead.siren,
      company_type: dbLead.company_type,
      creation_date: dbLead.creation_date,
      revenue_bracket: dbLead.revenue_bracket,
      employee_count: dbLead.employee_count,
      follower_count: dbLead.follower_count,
      website_quality: dbLead.website_quality,
      website_score: dbLead.website_score,
      has_https: dbLead.has_https ?? null,
      has_booking: dbLead.has_booking ?? null,
      has_chatbot: dbLead.has_chatbot ?? null,
      has_meta_ads: dbLead.has_meta_ads ?? null,
      meta_ads_count: dbLead.meta_ads_count ?? null,
      potential_score: dbLead.potential_score ?? null,
      source: dbLead.source || "Google Maps",
      enrichment_data: dbLead.enrichment_data || {},
    };

    leadInput.enrichment_data = { research_steps: {} };
    log(`[Enrich] Starting: ${dbLead.business_name} (${dbLead.location || "no location"})`);

    // ── Phase A: structured APIs, no browser (~5-15 s) ──────────────────────
    log(`[Enrich] Phase A: APIs...`);
    const partial = await runEnrichmentPhaseA(
      leadInput,
      dbLead.location || "",
      log
    );

    // Save Phase A data immediately so the employee sees owner/legal info
    // even if Phase B is still running or eventually fails.
    await serviceClient
      .from("leads")
      .update({
        owner_name: partial.owner_name,
        owner_role: partial.owner_role,
        siren: partial.siren,
        company_type: partial.company_type,
        creation_date: partial.creation_date,
        employee_count: partial.employee_count,
        address: partial.address,
        has_https: partial.has_https,
        website_score: partial.website_score,
        enrichment_data: partial.enrichment_data || {},
      })
      .eq("id", leadId);

    log(`[Enrich] Phase A saved. Owner: ${partial.owner_name || "—"} | SIREN: ${partial.siren || "—"}`);

    // ── Phase B: Playwright waves (~60-90 s) ─────────────────────────────────
    log(`[Enrich] Phase B: browser waves...`);
    const full = await runEnrichmentPhaseB(partial, dbLead.location || "", log);

    // ── Scoring + sales brief ────────────────────────────────────────────────
    log(`[Enrich] Computing score + sales brief...`);
    const score = computeLeadScore(full);
    const brief = await generateSalesBrief(full, log).catch(() => null);

    full.potential_score = score;
    full.enrichment_data = {
      ...(full.enrichment_data || {}),
      sales_brief: brief,
    };

    log(`[Enrich] Score: ${score}/100`);

    // ── Final DB write ────────────────────────────────────────────────────────
    await serviceClient
      .from("leads")
      .update({
        phone: full.phone,
        email: full.email,
        address: full.address,
        description: full.description,
        has_website: full.has_website,
        website_url: full.website_url,
        website_quality: full.website_quality,
        website_score: full.website_score,
        facebook_url: full.facebook_url,
        instagram_url: full.instagram_url,
        owner_name: full.owner_name,
        owner_phone: full.owner_phone,
        owner_email: full.owner_email,
        owner_role: full.owner_role,
        linkedin_url: full.linkedin_url,
        siren: full.siren,
        company_type: full.company_type,
        creation_date: full.creation_date,
        revenue_bracket: full.revenue_bracket,
        employee_count: full.employee_count,
        follower_count: full.follower_count,
        has_https: full.has_https,
        has_booking: full.has_booking,
        has_chatbot: full.has_chatbot,
        has_meta_ads: full.has_meta_ads,
        meta_ads_count: full.meta_ads_count,
        potential_score: full.potential_score,
        enrichment_status: "completed",
        enrichment_data: full.enrichment_data || {},
      })
      .eq("id", leadId);

    log(`[Enrich] Completed: ${dbLead.business_name}`);

    const { data: updatedLead } = await serviceClient
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    return NextResponse.json({ lead: updatedLead, logs });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Enrichment failed";
    log(`[Enrich] ✗ FATAL: ${msg}`);
    console.error("Lead enrichment error:", msg, error);

    try {
      const { leadId } = await request.clone().json();
      if (leadId) {
        const serviceClient = await createServiceClient();
        await serviceClient
          .from("leads")
          .update({
            enrichment_status: "failed",
            enrichment_data: { error: msg, logs },
          })
          .eq("id", leadId);
      }
    } catch {
      /* ignore */
    }

    return NextResponse.json({ error: msg, logs }, { status: 500 });
  }
}
