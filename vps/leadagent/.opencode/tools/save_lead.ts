import { tool } from "@opencode-ai/plugin";
import { supabase } from "./_shared";

export default tool({
  description:
    "Sauvegarde ou met à jour un lead dans la base Supabase d'Agence. Si SIREN ou nom+ville matche un existant, met à jour. Sinon, crée. Renvoie le lead_id.",
  args: {
    business_name: tool.schema.string(),
    location: tool.schema.string().optional(),
    niche: tool.schema.string().optional(),
    description: tool.schema.string().optional(),
    address: tool.schema.string().optional(),
    phone: tool.schema.string().optional(),
    email: tool.schema.string().optional(),

    has_website: tool.schema.boolean().optional(),
    website_url: tool.schema.string().optional(),
    website_quality: tool.schema
      .enum(["none", "dead", "outdated", "poor", "decent", "good"])
      .optional(),
    website_score: tool.schema.number().optional(),
    has_https: tool.schema.boolean().optional(),
    has_booking: tool.schema.boolean().optional(),
    has_chatbot: tool.schema.boolean().optional(),

    google_maps_url: tool.schema.string().optional(),
    rating: tool.schema.string().optional(),
    review_count: tool.schema.string().optional(),
    review_highlights: tool.schema.array(tool.schema.string()).optional(),

    facebook_url: tool.schema.string().optional(),
    instagram_url: tool.schema.string().optional(),
    follower_count: tool.schema.number().optional(),
    has_meta_ads: tool.schema.boolean().optional(),
    meta_ads_count: tool.schema.number().optional(),

    linkedin_url: tool.schema.string().optional(),
    owner_name: tool.schema.string().optional(),
    owner_role: tool.schema.string().optional(),
    owner_phone: tool.schema.string().optional(),
    owner_email: tool.schema.string().optional(),

    siren: tool.schema.string().optional(),
    company_type: tool.schema.string().optional(),
    creation_date: tool.schema.string().optional(),
    revenue_bracket: tool.schema.string().optional(),
    employee_count: tool.schema.string().optional(),

    potential_score: tool.schema.number().optional(),
    priority_score: tool.schema.enum(["hot", "warm", "cold"]).optional(),
    prospect_analysis: tool.schema.string().optional(),
    targeted_offer: tool.schema.string().optional(),
    identified_need: tool.schema.string().optional(),

    source: tool.schema.string().optional(),
    enrichment_data: tool.schema.record(tool.schema.unknown()).optional(),
  },
  async execute(args, ctx) {
    const sb = supabase();
    const userId = process.env.AGENT_USER_ID?.trim();
    if (!userId) {
      return { error: "AGENT_USER_ID env var required (uuid of the Supabase user owning these leads)." };
    }

    // Try to find existing
    let existing: { id: string } | null = null;
    if (args.siren) {
      const { data } = await sb
        .from("leads")
        .select("id")
        .eq("siren", args.siren)
        .eq("user_id", userId)
        .maybeSingle();
      existing = data;
    }
    if (!existing) {
      const { data } = await sb
        .from("leads")
        .select("id")
        .eq("user_id", userId)
        .ilike("business_name", args.business_name)
        .ilike("location", args.location ?? "")
        .maybeSingle();
      existing = data;
    }

    const payload = {
      ...args,
      user_id: userId,
      enrichment_status: "completed" as const,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { data, error } = await sb
        .from("leads")
        .update(payload)
        .eq("id", existing.id)
        .select("id")
        .single();
      if (error) return { error: error.message };
      return { saved: true, action: "updated", lead_id: data.id, session_id: ctx?.sessionID };
    }

    const { data, error } = await sb
      .from("leads")
      .insert({ ...payload, created_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error) return { error: error.message };
    return { saved: true, action: "created", lead_id: data.id, session_id: ctx?.sessionID };
  },
});
