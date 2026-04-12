import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  runSixStepEnrichment,
  type LeadResult,
  type OnStepComplete,
} from "@/lib/lead-agent";
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
      return NextResponse.json({ error: "leadId is required" }, { status: 400 });
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
      .update({ enrichment_status: "enriching", enrichment_step: "starting" })
      .eq("id", leadId);

    const lead: LeadResult = {
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
      enrichment_data: {},
      niche: dbLead.niche ?? null,
    };

    log(`[Enrich] Starting 6-step pipeline: ${dbLead.business_name} (${dbLead.location || "no location"})`);

    // Persist partial results after each step
    const onStepComplete: OnStepComplete = async (stepName, partial) => {
      const update: Record<string, unknown> = {
        enrichment_step: stepName,
        updated_at: new Date().toISOString(),
      };

      const fields = [
        "has_website", "website_url", "website_quality", "website_score",
        "has_https", "has_booking", "has_chatbot",
        "owner_name", "owner_role", "owner_phone", "owner_email",
        "linkedin_url", "siren", "company_type", "creation_date",
        "employee_count", "revenue_bracket", "address",
        "phone", "email", "facebook_url", "instagram_url",
        "follower_count", "has_meta_ads", "meta_ads_count", "description",
        "potential_score", "prospect_analysis", "targeted_offer",
        "identified_need", "priority_score", "enrichment_data",
      ] as const;

      for (const f of fields) {
        if (f in partial && (partial as Record<string, unknown>)[f] !== undefined) {
          update[f] = (partial as Record<string, unknown>)[f];
        }
      }

      await serviceClient.from("leads").update(update).eq("id", leadId);
      log(`[Enrich] ✓ Step saved: ${stepName}`);
    };

    const enriched = await runSixStepEnrichment(
      lead,
      dbLead.location || "",
      log,
      onStepComplete
    );

    // Final write
    await serviceClient
      .from("leads")
      .update({
        phone: enriched.phone,
        email: enriched.email,
        address: enriched.address,
        description: enriched.description,
        has_website: enriched.has_website,
        website_url: enriched.website_url,
        website_quality: enriched.website_quality,
        website_score: enriched.website_score,
        facebook_url: enriched.facebook_url,
        instagram_url: enriched.instagram_url,
        owner_name: enriched.owner_name,
        owner_phone: enriched.owner_phone,
        owner_email: enriched.owner_email,
        owner_role: enriched.owner_role,
        linkedin_url: enriched.linkedin_url,
        siren: enriched.siren,
        company_type: enriched.company_type,
        creation_date: enriched.creation_date,
        revenue_bracket: enriched.revenue_bracket,
        employee_count: enriched.employee_count,
        follower_count: enriched.follower_count,
        has_https: enriched.has_https,
        has_booking: enriched.has_booking,
        has_chatbot: enriched.has_chatbot,
        has_meta_ads: enriched.has_meta_ads,
        meta_ads_count: enriched.meta_ads_count,
        potential_score: enriched.potential_score,
        prospect_analysis: enriched.prospect_analysis ?? null,
        targeted_offer: enriched.targeted_offer ?? null,
        identified_need: enriched.identified_need ?? null,
        priority_score: enriched.priority_score ?? "cold",
        enrichment_status: "completed",
        enrichment_step: "done",
        enrichment_data: enriched.enrichment_data || {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    log(`[Enrich] ✓ Completed: ${dbLead.business_name} | score=${enriched.potential_score}/100`);

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
            enrichment_step: "failed",
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
