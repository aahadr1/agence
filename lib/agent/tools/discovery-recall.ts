import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";

registerTool(
  {
    name: "discovery_recall",
    description:
      "Récupère les derniers résultats de découverte (Google Maps) sauvegardés pour cette session. Utile si tu as 'perdu' ta liste de candidats ou si tu reprends une mission interrompue.",
    parameters: {},
    required: [],
    costEstimateCents: 0,
  },
  async (_args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) {
      throw new Error("discovery_recall requiert une session active.");
    }

    const { data, error } = await db
      .from("agent_discovery_snapshots")
      .select("query, lead_count, payload, created_at")
      .eq("session_id", context.sessionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(`Erreur lors du rappel : ${error.message}`);
    if (!data) {
      return {
        ok: false,
        message: "Aucun snapshot de découverte trouvé pour cette session. Tu dois sans doute lancer une première recherche avec google_maps_search.",
      };
    }

    return {
      ok: true,
      query: data.query,
      lead_count: data.lead_count,
      captured_at: data.created_at,
      leads: data.payload.leads || [],
      message: `Rappel réussi : ${data.lead_count} candidats récupérés depuis la recherche « ${data.query} » du ${new Date(data.created_at).toLocaleString()}.`,
    };
  }
);
