import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runLeadAgent } from "@/lib/lead-agent";
import { NextResponse } from "next/server";

// Long-running: agent browses Google Maps (2-5 min)
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { niche, location } = await request.json();

  if (!niche || !location) {
    return NextResponse.json(
      { error: "Niche and location are required" },
      { status: 400 }
    );
  }

  const serviceClient = await createServiceClient();

  try {
    // 1. Create search record
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

    // 2. Run the browser agent (Playwright + Gemini Flash)
    await serviceClient
      .from("lead_searches")
      .update({ status: "analyzing", updated_at: new Date().toISOString() })
      .eq("id", search.id);

    const leads = await runLeadAgent(niche, location);

    // 3. Save leads to database
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
      }));

      const { error: leadsErr } = await serviceClient
        .from("leads")
        .insert(leadsToInsert);

      if (leadsErr) {
        console.error("Failed to insert leads:", leadsErr);
      }
    }

    // 4. Mark search as completed
    const noWebsiteCount = leads.filter((l) => !l.has_website).length;
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
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Search failed";
    console.error("Lead generator error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
