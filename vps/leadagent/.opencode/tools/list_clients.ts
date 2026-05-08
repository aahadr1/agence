import { tool } from "@opencode-ai/plugin";
import { supabase } from "./_shared";

export default tool({
  description:
    "Liste les leads/clients existants dans la base Supabase d'Agence. À appeler AVANT de sauvegarder pour éviter les doublons. Filtre par SIREN, nom, ville, niche, statut.",
  args: {
    siren: tool.schema.string().optional(),
    business_name: tool.schema.string().optional(),
    location: tool.schema.string().optional(),
    niche: tool.schema.string().optional(),
    priority_score: tool.schema.enum(["hot", "warm", "cold"]).optional(),
    pipeline_status: tool.schema.string().optional(),
    limit: tool.schema.number().default(20),
  },
  async execute(args) {
    const sb = supabase();
    const userId = process.env.AGENT_USER_ID?.trim();
    if (!userId) {
      return { error: "AGENT_USER_ID env var required." };
    }

    let q = sb
      .from("leads")
      .select(
        "id, business_name, location, niche, siren, phone, email, owner_name, potential_score, priority_score, pipeline_status, has_website, website_url, created_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(args.limit ?? 20, 100));

    if (args.siren) q = q.eq("siren", args.siren);
    if (args.business_name) q = q.ilike("business_name", `%${args.business_name}%`);
    if (args.location) q = q.ilike("location", `%${args.location}%`);
    if (args.niche) q = q.ilike("niche", `%${args.niche}%`);
    if (args.priority_score) q = q.eq("priority_score", args.priority_score);
    if (args.pipeline_status) q = q.eq("pipeline_status", args.pipeline_status);

    const { data, error, count } = await q;
    if (error) return { error: error.message };

    return {
      count: data?.length ?? 0,
      total_in_db: count,
      leads: data ?? [],
    };
  },
});
