import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runDiscovery } from "@/lib/lead-agent";
import { augmentLeadsWithAiWebsites } from "@/lib/lead-agent/enrichment/batch-website-ai";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { niche, location, excludeNames, attemptedQueries, attemptedKeywords } =
      await request.json();

    if (!niche || !location) {
      return NextResponse.json(
        { error: "Niche and location are required" },
        { status: 400 }
      );
    }

    const serviceClient = await createServiceClient();
    const orgId = await resolveOrgIdForUser(serviceClient, user.id);

    // Create search record
    const { data: search, error: insertErr } = await serviceClient
      .from("lead_searches")
      .insert({
        org_id: orgId,
        user_id: user.id,
        niche,
        location,
        status: "searching",
      })
      .select()
      .single();

    if (insertErr || !search) {
      return NextResponse.json(
        { error: insertErr?.message || "Failed to create search record" },
        { status: 500 }
      );
    }

    // Run discovery only (enrichment happens per-lead via /api/lead-generator/enrich)
    await serviceClient
      .from("lead_searches")
      .update({ status: "analyzing", updated_at: new Date().toISOString() })
      .eq("id", search.id);

    const { leads, keywords, discovery } = await runDiscovery(niche, location, {
      excludeNames: excludeNames || [],
      attemptedQueries: attemptedQueries || [],
      attemptedKeywords: attemptedKeywords || [],
    });

    // Sans Playwright fiable sur Maps : compléter les URLs manquantes (Gemini + vérif HTTP)
    if (leads.length > 0) {
      await augmentLeadsWithAiWebsites(leads, location, console.log);
    }

    // Save leads to database with enrichment_status = "pending"
    if (leads.length > 0) {
      const leadsToInsert = leads.map((lead) => ({
        org_id: orgId,
        search_id: search.id,
        user_id: user.id,
        business_name: lead.business_name,
        description: lead.description,
        address: lead.address,
        phone: lead.phone,
        email: lead.email,
        rating: lead.rating,
        review_count: lead.review_count,
        review_highlights: lead.review_highlights,
        niche,
        location,
        source: lead.source,
        has_website: Boolean(lead.website_url?.trim()) || lead.has_website,
        website_url: lead.website_url,
        google_maps_url: lead.google_maps_url,
        website_quality: null,
        website_score: null,
        owner_name: null,
        owner_phone: null,
        owner_email: null,
        owner_role: null,
        linkedin_url: null,
        siren: null,
        company_type: null,
        creation_date: null,
        revenue_bracket: null,
        employee_count: null,
        facebook_url: null,
        instagram_url: null,
        follower_count: null,
        has_https: null,
        has_booking: null,
        has_chatbot: null,
        has_meta_ads: null,
        meta_ads_count: null,
        enrichment_status: "pending",
        enrichment_data: {},
      }));

      await serviceClient.from("leads").insert(leadsToInsert);
    }

    // Mark search as completed
    await serviceClient
      .from("lead_searches")
      .update({
        status: "completed",
        leads_count: leads.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", search.id);

    return NextResponse.json({
      searchId: search.id,
      leadsCount: leads.length,
      keywords,
      discovery,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Search failed";
    console.error("Lead generator error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
