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
 *
 * Defense in depth: if the `stub_session_key` column hasn't been added yet
 * (migration 024 not applied), falls back to querying by `agent_session_id`.
 */
export async function ensureAgentLeadSearchId(
  params: EnsureAgentLeadSearchParams,
): Promise<string> {
  const db = getAgentDb();
  const stubKey = params.sessionId;

  // Try to find an existing stub row — prefer stub_session_key, fall back to
  // agent_session_id if the column doesn't exist yet.
  let existingId: string | null = null;
  try {
    const { data: existing, error: selErr } = await db
      .from("lead_searches")
      .select("id")
      .eq("stub_session_key", stubKey)
      .maybeSingle();

    if (selErr && selErr.message?.includes("stub_session_key")) {
      // Column doesn't exist — fall back to agent_session_id
      const { data: fallback } = await db
        .from("lead_searches")
        .select("id")
        .eq("agent_session_id", stubKey)
        .maybeSingle();
      existingId = fallback?.id ?? null;
    } else if (selErr) {
      throw new Error(`ensureAgentLeadSearchId(select): ${selErr.message}`);
    } else {
      existingId = existing?.id ?? null;
    }
  } catch (e: unknown) {
    // Catch-all for column-missing errors that surface as thrown exceptions
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("stub_session_key")) {
      const { data: fallback } = await db
        .from("lead_searches")
        .select("id")
        .eq("agent_session_id", stubKey)
        .maybeSingle();
      existingId = fallback?.id ?? null;
    } else {
      throw e;
    }
  }

  if (existingId) return existingId;

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

  // Build insert payload — omit stub_session_key if column might not exist
  const insertPayload: Record<string, unknown> = {
    org_id: params.orgId,
    user_id: params.userId,
    niche,
    location,
    status: "searching",
    stub_session_key: stubKey,
    agent_session_id: sess?.id ?? null,
    leads_count: 0,
    raw_research,
  };

  let { data: inserted, error: insErr } = await db
    .from("lead_searches")
    .insert(insertPayload)
    .select("id")
    .single();

  // If insert fails because stub_session_key column doesn't exist, retry without it
  if (insErr?.message?.includes("stub_session_key")) {
    delete insertPayload.stub_session_key;
    const retry = await db
      .from("lead_searches")
      .insert(insertPayload)
      .select("id")
      .single();
    inserted = retry.data;
    insErr = retry.error;
  }

  if (!insErr && inserted?.id) return inserted.id;

  // Handle duplicate race condition
  if (insErr?.code === "23505" || insErr?.message?.includes("duplicate")) {
    // Try stub_session_key first, then agent_session_id
    const { data: again } = await db
      .from("lead_searches")
      .select("id")
      .eq("agent_session_id", stubKey)
      .maybeSingle();
    if (again?.id) return again.id;
  }

  throw new Error(
    `ensureAgentLeadSearchId(insert): ${insErr?.message || "unknown error"}`,
  );
}
