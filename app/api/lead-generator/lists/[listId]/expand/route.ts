import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runFullPipeline } from "@/lib/lead-agent";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  const { listId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const serviceClient = await createServiceClient();

  // Get list with keywords and excluded names
  const { data: list } = await serviceClient
    .from("lead_lists")
    .select("*")
    .eq("id", listId)
    .eq("user_id", user.id)
    .single();

  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const { niche, location } = await request.json();

  // Use stored keywords or the provided niche/location
  const searchNiche = niche || list.keywords?.[0] || "business";
  const searchLocation = location || list.keywords?.[1] || "";

  if (!searchLocation) {
    return NextResponse.json({ error: "Location is required" }, { status: 400 });
  }

  try {
    // Run pipeline excluding already-known businesses
    const { leads, keywords } = await runFullPipeline(
      searchNiche,
      searchLocation,
      list.excluded_business_names || []
    );

    if (leads.length === 0) {
      return NextResponse.json({ message: "No new businesses found", added: 0 });
    }

    // Create a search record for tracking
    const { data: search } = await serviceClient
      .from("lead_searches")
      .insert({
        user_id: user.id,
        niche: searchNiche,
        location: searchLocation,
        status: "completed",
        leads_count: leads.length,
      })
      .select()
      .single();

    // Save new leads
    const leadsToInsert = leads.map((lead) => ({
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
      website_quality: lead.website_quality,
      website_score: lead.website_score,
      owner_name: lead.owner_name,
      facebook_url: lead.facebook_url,
      instagram_url: lead.instagram_url,
      follower_count: lead.follower_count,
      enrichment_status: "completed",
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

      await serviceClient
        .from("lead_lists")
        .update({
          excluded_business_names: mergedNames,
          keywords: mergedKeywords,
          updated_at: new Date().toISOString(),
        })
        .eq("id", listId);
    }

    return NextResponse.json({
      added: insertedLeads?.length || 0,
      total: leads.length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Expand failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
