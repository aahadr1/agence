import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchId, niche, location, aiOutput } = await request.json();

  if (!searchId || !aiOutput) {
    return NextResponse.json(
      { error: "searchId and aiOutput are required" },
      { status: 400 }
    );
  }

  try {
    // Parse the AI output — handle markdown code blocks if present
    let cleanOutput = aiOutput.trim();
    if (cleanOutput.startsWith("```")) {
      cleanOutput = cleanOutput.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const businesses = JSON.parse(cleanOutput);

    if (!Array.isArray(businesses)) {
      throw new Error("AI output is not an array");
    }

    // Insert leads into the database (service role bypasses RLS)
    const serviceClient = await createServiceClient();
    const leadsToInsert = businesses.map((b: Record<string, unknown>) => ({
      search_id: searchId,
      user_id: user.id,
      business_name: b.business_name || "Unknown",
      description: b.description || null,
      address: b.address || null,
      phone: b.phone || null,
      email: b.email || null,
      rating: b.rating || null,
      review_count: b.review_count || null,
      review_highlights: b.review_highlights || null,
      niche,
      location,
      source: b.source || null,
      has_website: b.has_website ?? false,
      website_url: b.website_url || null,
      google_maps_url: b.google_maps_url || null,
    }));

    if (leadsToInsert.length > 0) {
      const { error: insertError } = await serviceClient
        .from("leads")
        .insert(leadsToInsert);

      if (insertError) {
        throw new Error(`Failed to insert leads: ${insertError.message}`);
      }
    }

    // Update search status
    await serviceClient
      .from("lead_searches")
      .update({
        status: "completed",
        leads_count: leadsToInsert.length,
        updated_at: new Date().toISOString(),
      })
      .eq("id", searchId);

    return NextResponse.json({
      success: true,
      leadsCount: leadsToInsert.length,
      withoutWebsite: leadsToInsert.filter((l) => !l.has_website).length,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Save failed";
    console.error("Lead generator save error:", msg, error);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
