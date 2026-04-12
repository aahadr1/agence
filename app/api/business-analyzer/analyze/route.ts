import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runBusinessAnalysis, type AnalysisInput } from "@/lib/business-analyzer";
import { NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { inputType, inputValue, city, leadId } = body as {
      inputType: "name_city" | "google_maps_url" | "siret";
      inputValue: string;
      city?: string;
      leadId?: string;
    };

    if (!inputType || !inputValue) {
      return NextResponse.json(
        { error: "inputType and inputValue are required" },
        { status: 400 }
      );
    }

    const serviceClient = await createServiceClient();
    const orgId = await resolveOrgIdForUser(serviceClient, user.id);

    // Create analysis record
    const { data: analysis, error: insertErr } = await serviceClient
      .from("business_analyses")
      .insert({
        org_id: orgId,
        user_id: user.id,
        lead_id: leadId || null,
        input_type: inputType,
        input_value: inputValue,
        business_name: inputValue,
        status: "analyzing",
      })
      .select()
      .single();

    if (insertErr || !analysis) {
      return NextResponse.json(
        { error: insertErr?.message || "Failed to create analysis" },
        { status: 500 }
      );
    }

    // Run the full analysis
    const input: AnalysisInput = {
      type: inputType,
      value: inputValue,
      city,
    };

    const result = await runBusinessAnalysis(input);

    // Save complete result
    await serviceClient
      .from("business_analyses")
      .update({
        business_name: result.business_name,
        address: result.address,
        phone: result.phone,
        email: result.email,
        google_maps_url: result.google_maps_url,
        siren: result.siren,
        siret: result.siret,
        company_type: result.company_type,
        creation_date: result.creation_date,
        revenue_bracket: result.revenue_bracket,
        employee_count: result.employee_count,
        owner_name: result.owner_name,
        owner_role: result.owner_role,
        owner_phone: result.owner_phone,
        owner_email: result.owner_email,
        linkedin_url: result.linkedin_url,
        website_url: result.website_url,
        website_score: result.website_score,
        website_quality: result.website_quality,
        has_https: result.has_https,
        has_booking: result.has_booking,
        has_chatbot: result.has_chatbot,
        google_rating: result.google_rating,
        google_review_count: result.google_review_count,
        review_trend: result.review_trend,
        review_highlights: result.review_highlights,
        facebook_url: result.facebook_url,
        facebook_followers: result.facebook_followers,
        instagram_url: result.instagram_url,
        instagram_followers: result.instagram_followers,
        has_meta_ads: result.has_meta_ads,
        meta_ads_count: result.meta_ads_count,
        potential_score: result.potential_score,
        pain_points: result.pain_points,
        recommended_offers: result.recommended_offers,
        competitors: result.competitors,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", analysis.id);

    // Also update linked lead if provided
    if (leadId) {
      await serviceClient
        .from("leads")
        .update({
          has_https: result.has_https,
          has_booking: result.has_booking,
          has_chatbot: result.has_chatbot,
          has_meta_ads: result.has_meta_ads,
          meta_ads_count: result.meta_ads_count,
          potential_score: result.potential_score,
          pain_points: result.pain_points,
          recommended_offers: result.recommended_offers,
        })
        .eq("id", leadId);
    }

    // Fetch and return the complete analysis
    const { data: finalAnalysis } = await serviceClient
      .from("business_analyses")
      .select("*")
      .eq("id", analysis.id)
      .single();

    return NextResponse.json({ analysis: finalAnalysis });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Analysis failed";
    console.error("Business analysis error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
