import { getAgentDb } from "./tools/_db";
import { writeScratchpadText } from "./tools/scratchpad";
import { upsertWorksetItems } from "./workset-state";

interface MapsPayload {
  leads?: unknown[];
  blocked?: boolean;
  secondary_query_used?: string | null;
}

interface MapsPersistArgs {
  sessionId: string;
  query: string;
  maxResultsRequested: number;
  targetCount: number | null;
  payload: MapsPayload;
  scratchpad?: Map<string, unknown>;
}

function asLeadRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function persistGoogleMapsSearchResult({
  sessionId,
  query,
  maxResultsRequested,
  targetCount,
  payload,
  scratchpad,
}: MapsPersistArgs): Promise<void> {
  if (!sessionId || payload.blocked || !Array.isArray(payload.leads)) return;

  const leads = payload.leads.map(asLeadRecord).filter(Boolean) as Record<
    string,
    unknown
  >[];
  if (!leads.length) return;

  const db = getAgentDb();
  await db.from("agent_discovery_snapshots").insert({
    session_id: sessionId,
    query: query.slice(0, 500),
    lead_count: leads.length,
    payload: {
      max_results_requested: maxResultsRequested,
      leads,
      secondary_query_used: payload.secondary_query_used ?? null,
    },
  });

  const workingSet = {
    source: "google_maps_search",
    query,
    captured_at: new Date().toISOString(),
    max_results_requested: maxResultsRequested,
    secondary_query_used: payload.secondary_query_used ?? null,
    candidates: leads,
  };
  const serialized = JSON.stringify(workingSet);
  await writeScratchpadText(sessionId, "candidates", serialized);
  scratchpad?.set("candidates", serialized);

  await upsertWorksetItems(
    sessionId,
    leads.map((lead, index) => ({
      ...lead,
      title: String(lead.business_name || lead.name || `Candidate ${index + 1}`),
      status: "new",
      priority: index + 1,
      missing: [
        ...(lead.phone || lead.email ? [] : ["contact"]),
        "dirigeant_or_siren",
        "data_provenance",
      ],
      next_action:
        "Pré-qualifier avec les champs disponibles, puis enrichir seulement si ce candidat reste utile pour l'objectif.",
    })),
    {
      source: "google_maps_search",
      goal: query,
      target_count: targetCount,
    },
  );
}
