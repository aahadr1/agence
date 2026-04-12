import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import {
  DEFAULT_EXPAND_TARGET,
  mergeSearchContext,
  normalizeSearchContext,
} from "@/lib/lead-agent/search-context";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runDiscovery } from "@/lib/lead-agent";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  try {
    const { listId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const serviceClient = await createServiceClient();
    const orgId = await resolveOrgIdForUser(serviceClient, user.id);

    // Get list with keywords and excluded names
    const { data: list } = await serviceClient
      .from("lead_lists")
      .select("*")
      .eq("id", listId)
      .eq("org_id", orgId)
      .single();

    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

    const { niche, location } = await request.json();
    const currentContext = normalizeSearchContext(list.search_context, {
      niche,
      location,
      attempted_keywords: list.keywords || [],
      target_min_new_leads: DEFAULT_EXPAND_TARGET,
    });

    const searchNiche = niche || currentContext.niche || list.keywords?.[0] || "business";
    const searchLocation =
      location || currentContext.location || list.keywords?.[1] || "";

    if (!searchLocation) {
      return NextResponse.json({ error: "Location is required" }, { status: 400 });
    }

    // Run discovery only (enrichment happens per-lead via /api/lead-generator/enrich)
    const { leads, keywords, discovery } = await runDiscovery(searchNiche, searchLocation, {
      excludeNames: list.excluded_business_names || [],
      attemptedQueries: currentContext.attempted_queries,
      attemptedKeywords: currentContext.attempted_keywords,
      targetMinLeads: currentContext.target_min_new_leads || DEFAULT_EXPAND_TARGET,
    });

    const searchContextBase = {
      niche: searchNiche,
      location: searchLocation,
      attempted_queries: discovery.used_queries,
      attempted_keywords: discovery.attempted_keywords,
      successful_queries: discovery.successful_queries,
      last_generated_queries: discovery.generated_queries,
      target_min_new_leads: discovery.target_min_new_leads,
      expansion_count: currentContext.expansion_count + 1,
      last_run_added: 0,
      last_expanded_at: new Date().toISOString(),
    };

    if (leads.length === 0) {
      await serviceClient
        .from("lead_lists")
        .update({
          keywords: [...new Set([...(list.keywords || []), ...keywords])],
          search_context: mergeSearchContext(list.search_context, searchContextBase),
          updated_at: new Date().toISOString(),
        })
        .eq("id", listId);

      return NextResponse.json({
        message:
          discovery.generated_queries.length === 0
            ? "No fresh keyword variants remain for this list"
            : "No new businesses found after trying fresh keyword variants",
        added: 0,
      });
    }

    // Create a search record for tracking
    const { data: search } = await serviceClient
      .from("lead_searches")
      .insert({
        org_id: orgId,
        user_id: user.id,
        niche: searchNiche,
        location: searchLocation,
        status: "completed",
        leads_count: leads.length,
      })
      .select()
      .single();

    // Save new leads with enrichment_status = "pending"
    const leadsToInsert = leads.map((lead) => ({
      org_id: orgId,
      search_id: search?.id,
      user_id: user.id,
      business_name: lead.business_name,
      description: lead.description,
      address: lead.address,
      phone: lead.phone,
      email: lead.email,
      rating: lead.rating,
      review_count: lead.review_count,
      review_highlights: lead.review_highlights,
      niche: searchNiche,
      location: searchLocation,
      source: lead.source,
      has_website: lead.has_website,
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

    const { data: insertedLeads } = await serviceClient
      .from("leads")
      .insert(leadsToInsert)
      .select("id, business_name");

    if (insertedLeads && insertedLeads.length > 0) {
      // Add to list
      const items = insertedLeads.map((l: { id: string }) => ({
        list_id: listId,
        lead_id: l.id,
        status: "new",
      }));
      await serviceClient.from("lead_list_items").insert(items);

      // Update excluded names and keywords
      const newNames = insertedLeads.map((l: { business_name: string }) => l.business_name);
      const mergedNames = [...new Set([...(list.excluded_business_names || []), ...newNames])];
      const mergedKeywords = [...new Set([...(list.keywords || []), ...keywords])];
      const mergedContext = mergeSearchContext(list.search_context, {
        ...searchContextBase,
        last_run_added: insertedLeads.length,
      });

      await serviceClient
        .from("lead_lists")
        .update({
          excluded_business_names: mergedNames,
          keywords: mergedKeywords,
          search_context: mergedContext,
          updated_at: new Date().toISOString(),
        })
        .eq("id", listId);
    }

    return NextResponse.json({
      added: insertedLeads?.length || 0,
      total: leads.length,
      leadIds: insertedLeads?.map((lead) => lead.id) || [],
      message:
        (insertedLeads?.length || 0) >= discovery.target_min_new_leads
          ? `Added ${(insertedLeads?.length || 0).toString()} new businesses`
          : `Added ${(insertedLeads?.length || 0).toString()} new businesses after trying fresh keyword variants`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead generator error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
