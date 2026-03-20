import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runSingleLeadEnrichment, type LeadResult } from "@/lib/lead-agent";
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

    const { leadId } = await request.json();
    if (!leadId) {
      return NextResponse.json(
        { error: "leadId is required" },
        { status: 400 }
      );
    }

    const serviceClient = await createServiceClient();

    // Load lead from DB
    const { data: dbLead } = await serviceClient
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("user_id", user.id)
      .single();

    if (!dbLead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Skip if already enriched
    if (dbLead.enrichment_status === "completed") {
      return NextResponse.json({ lead: dbLead, skipped: true });
    }

    // Mark as enriching
    await serviceClient
      .from("leads")
      .update({ enrichment_status: "enriching" })
      .eq("id", leadId);

    // Convert DB lead to LeadResult
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
      source: dbLead.source || "Google Maps",
      enrichment_data: dbLead.enrichment_data || {},
    };

    // Run enrichment
    const enriched = await runSingleLeadEnrichment(
      leadInput,
      dbLead.location || ""
    );

    // Update lead in DB
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
        enrichment_status: "completed",
        enrichment_data: enriched.enrichment_data || {},
      })
      .eq("id", leadId);

    // Return the updated lead
    const { data: updatedLead } = await serviceClient
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    return NextResponse.json({ lead: updatedLead });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Enrichment failed";
    console.error("Lead enrichment error:", msg, error);

    // Try to mark lead as failed
    try {
      const { leadId } = await request.clone().json();
      if (leadId) {
        const serviceClient = await createServiceClient();
        await serviceClient
          .from("leads")
          .update({ enrichment_status: "failed" })
          .eq("id", leadId);
      }
    } catch {
      // ignore
    }

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
