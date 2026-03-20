import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runFullPipeline } from "@/lib/lead-agent";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { niche, location, excludeNames } = await request.json();

  if (!niche || !location) {
    return NextResponse.json(
      { error: "Niche and location are required" },
      { status: 400 }
    );
  }

  const serviceClient = await createServiceClient();

  try {
    // Create search record
    const { data: search, error: insertErr } = await serviceClient
      .from("lead_searches")
      .insert({
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

    // Run the full pipeline: discovery + enrichment
    await serviceClient
      .from("lead_searches")
      .update({ status: "analyzing", updated_at: new Date().toISOString() })
      .eq("id", search.id);

    const { leads, keywords } = await runFullPipeline(
      niche,
      location,
      excludeNames || []
    );

    // Save leads to database
    if (leads.length > 0) {
      const leadsToInsert = leads.map((lead) => ({
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
        has_website: lead.has_website,
        website_url: lead.website_url,
        google_maps_url: lead.google_maps_url,
        website_quality: lead.website_quality,
        website_score: lead.website_score,
        owner_name: lead.owner_name,
        owner_phone: lead.owner_phone,
        owner_email: lead.owner_email,
        owner_role: lead.owner_role,
        linkedin_url: lead.linkedin_url,
        siren: lead.siren,
        company_type: lead.company_type,
        creation_date: lead.creation_date,
        revenue_bracket: lead.revenue_bracket,
        employee_count: lead.employee_count,
        facebook_url: lead.facebook_url,
        instagram_url: lead.instagram_url,
        follower_count: lead.follower_count,
        enrichment_status: "completed",
        enrichment_data: lead.enrichment_data || {},
      }));

      await serviceClient.from("leads").insert(leadsToInsert);
    }

    // Mark search as completed
    const noWebsiteCount = leads.filter((l) => !l.has_website).length;
    const badWebsiteCount = leads.filter(
      (l) =>
        l.has_website &&
        (l.website_quality === "dead" ||
          l.website_quality === "outdated" ||
          l.website_quality === "poor")
    ).length;

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
      withoutWebsite: noWebsiteCount,
      badWebsite: badWebsiteCount,
      keywords,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Search failed";
    console.error("Lead generator error:", msg, error);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
