import { getAgentDb } from "./tools/_db";

export interface EnsureAgentLeadSearchParams {
  orgId: string;
  userId: string;
  sessionId: string;
  /** Short label for UI / debugging (e.g. mission snippet) */
  nicheHint?: string | null;
  /** City or zone the user locked (optional) */
  locationHint?: string | null;
}

/**
 * Returns the `lead_searches.id` for this agent session, creating a stub row
 * on first use so `leads.search_id` NOT NULL is satisfied (same model as the lead generator).
 */
export async function ensureAgentLeadSearchId(
  params: EnsureAgentLeadSearchParams,
): Promise<string> {
  const db = getAgentDb();
  const stubKey = params.sessionId;

  const { data: existing, error: selErr } = await db
    .from("lead_searches")
    .select("id")
    .eq("stub_session_key", stubKey)
    .maybeSingle();

  if (selErr) {
    throw new Error(`ensureAgentLeadSearchId(select): ${selErr.message}`);
  }
  if (existing?.id) return existing.id;

  const nicheRaw =
    (params.nicheHint?.trim() || "").slice(0, 400) ||
    "Recherche agent (session)";
  const niche = nicheRaw.length > 0 ? nicheRaw : "Recherche agent (session)";
  const location =
    (params.locationHint?.trim() || "").slice(0, 400) || "—";

  const raw_research = JSON.stringify({
    source: "agent_stub",
    stub_session_key: stubKey,
  });

  const { data: sess } = await db
    .from("agent_sessions")
    .select("id")
    .eq("id", stubKey)
    .maybeSingle();

  const { data: inserted, error: insErr } = await db
    .from("lead_searches")
    .insert({
      org_id: params.orgId,
      user_id: params.userId,
      niche,
      location,
      status: "searching",
      stub_session_key: stubKey,
      agent_session_id: sess?.id ?? null,
      leads_count: 0,
      raw_research,
    })
    .select("id")
    .single();

  if (!insErr && inserted?.id) return inserted.id;

  if (insErr?.code === "23505" || insErr?.message?.includes("duplicate")) {
    const { data: again } = await db
      .from("lead_searches")
      .select("id")
      .eq("stub_session_key", stubKey)
      .maybeSingle();
    if (again?.id) return again.id;
  }

  throw new Error(
    `ensureAgentLeadSearchId(insert): ${insErr?.message || "unknown error"}`,
  );
}
