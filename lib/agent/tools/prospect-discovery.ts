import { registerTool } from "../tool-registry";
import type { AgentContext } from "../types";
import { getAgentDb } from "./_db";
import {
  buildQueryVariants,
  searchWebWithBrowser,
  uniqueByBusinessKey,
} from "./v1-browser-utils";

const V1_WORKSPACE_KEY = "v1_prospect_workspace";
const DEFAULT_CONTACT_POLICY =
  "Establishment phone or establishment email counts as contact unless the user explicitly asks for owner-direct contact.";

type ProspectRow = Record<string, unknown>;
type V1Workspace = {
  prospects?: ProspectRow[];
  rejected?: ProspectRow[];
  tasks?: Array<Record<string, unknown>>;
  objective?: string | null;
  target_count?: number | null;
  acceptance_criteria?: string | null;
  contact_policy?: string | null;
  blocker_summary?: string | null;
  terminal_blocked?: boolean;
  exported_at?: string | null;
  exported_count?: number;
};

function normalizeLoose(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prospectKey(row: ProspectRow): string {
  return `${row.business_name || row.name || ""}|${row.address || row.location || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasContact(row: ProspectRow): boolean {
  return Boolean(String(row.phone || row.email || row.owner_phone || row.owner_email || "").trim());
}

function hasLegal(row: ProspectRow): boolean {
  return Boolean(String(row.owner_name || row.siren || row.siret || "").trim());
}

function inferStatus(row: ProspectRow): string {
  if (row.saved || row.lead_id) return "saved";
  if (row.status === "rejected") return "rejected";
  if (row.status === "needs_review") return "needs_review";
  if (Array.isArray(row.rejected_reasons) && row.rejected_reasons.length > 0) {
    return "needs_review";
  }
  if (hasContact(row) && hasLegal(row)) return "complete";
  if (hasLegal(row)) return "legal_found";
  if (hasContact(row)) return "contact_found";
  return "discovered";
}

function isRejectedCandidate(row: ProspectRow, rejected: ProspectRow[] = []): boolean {
  const name = normalizeLoose(row.business_name || row.name);
  const address = normalizeLoose(row.address || row.location);
  const siren = normalizeLoose(row.siren || row.siret);
  const maps = normalizeLoose(row.google_maps_url);
  if (!name && !siren && !maps) return false;
  return rejected.some((r) => {
    const rName = normalizeLoose(r.business_name || r.name);
    const rAddress = normalizeLoose(r.address || r.location);
    const rSiren = normalizeLoose(r.siren || r.siret);
    const rMaps = normalizeLoose(r.google_maps_url);
    if (siren && rSiren && siren === rSiren) return true;
    if (maps && rMaps && maps === rMaps) return true;
    if (!name || !rName || name !== rName) return false;
    if (!address || !rAddress) return true;
    return address === rAddress;
  });
}

async function persistDiscoveredCandidates(
  sessionId: string,
  payload: {
    niche: string;
    location: string;
    candidates: ProspectRow[];
  },
  target: number,
): Promise<{ workspace_count: number; skipped_rejected: number }> {
  const db = getAgentDb();
  const { data } = await db
    .from("agent_memory")
    .select("value")
    .eq("session_id", sessionId)
    .eq("key", V1_WORKSPACE_KEY)
    .maybeSingle();
  const value = ((data?.value as V1Workspace | null) || {}) as V1Workspace;
  const prospects = Array.isArray(value.prospects) ? value.prospects : [];
  const rejected = Array.isArray(value.rejected) ? value.rejected : [];
  const map = new Map<string, ProspectRow>();
  for (const row of prospects) {
    const key = prospectKey(row);
    if (key) map.set(key, { ...row, status: inferStatus(row) });
  }
  let skippedRejected = 0;
  for (const row of payload.candidates) {
    if (isRejectedCandidate(row, rejected)) {
      skippedRejected++;
      continue;
    }
    const key = prospectKey(row);
    if (!key) continue;
    const prev = map.get(key) || {};
    const provenance = `prospect_discovery ${row.source || "web"} query "${row.source_query || `${payload.niche} ${payload.location}`}"`;
    const merged = {
      ...prev,
      ...row,
      data_provenance: String(row.data_provenance || prev.data_provenance || provenance),
      discovered_at: prev.discovered_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const statusProbe = row.status ? merged : { ...merged, status: undefined };
    map.set(key, { ...merged, status: inferStatus(statusProbe) });
  }

  const workspace: V1Workspace = {
    prospects: [...map.values()],
    rejected,
    tasks: Array.isArray(value.tasks) ? value.tasks : [],
    objective:
      typeof value.objective === "string" && value.objective.trim()
        ? value.objective
        : `Find and qualify ${payload.niche} in ${payload.location}`,
    target_count:
      typeof value.target_count === "number" && value.target_count > 0
        ? value.target_count
        : target > 0
          ? target
          : null,
    acceptance_criteria:
      typeof value.acceptance_criteria === "string" && value.acceptance_criteria.trim()
        ? value.acceptance_criteria
        : "Final rows must have a verified business name, contact phone/email, legal identity (owner or SIREN), and source provenance.",
    contact_policy:
      typeof value.contact_policy === "string" && value.contact_policy.trim()
        ? value.contact_policy
        : DEFAULT_CONTACT_POLICY,
    blocker_summary: value.blocker_summary || null,
    terminal_blocked: value.terminal_blocked === true,
    exported_at: value.exported_at || null,
    exported_count: typeof value.exported_count === "number" ? value.exported_count : 0,
  };

  await db.from("agent_memory").upsert(
    {
      session_id: sessionId,
      key: V1_WORKSPACE_KEY,
      value: workspace,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id,key" },
  );
  return { workspace_count: workspace.prospects?.length || 0, skipped_rejected: skippedRejected };
}

registerTool(
  {
    name: "prospect_discovery",
    description:
      "Discover a broad candidate pool with Playwright. Runs multiple Google/Google Maps keyword variants, dedupes businesses, and stores a discovery snapshot for the session.",
    parameters: {
      niche: {
        type: "string",
        description: "Business type or target segment, e.g. restaurants, dentists, garages",
      },
      location: {
        type: "string",
        description: "Target city, region, or geographic perimeter",
      },
      target_count: {
        type: "number",
        description: "Desired final prospect count; discovery aims for about 2-3x",
        required: false,
      },
      constraints: {
        type: "string",
        description: "Optional filters/exclusions from the user brief",
        required: false,
      },
      max_candidates: {
        type: "number",
        description: "Max candidate pool size, default 60, cap 80",
        required: false,
      },
    },
    required: ["niche", "location"],
    costEstimateCents: 4,
  },
  async (args, context: AgentContext) => {
    const niche = String(args.niche || "").trim();
    const location = String(args.location || "").trim();
    if (!niche || !location) {
      throw new Error("prospect_discovery requires niche and location");
    }

    const target = Math.max(Number(args.target_count) || 0, 0);
    const maxCandidates = Math.min(
      Math.max(Number(args.max_candidates) || (target ? target * 3 : 60), 10),
      80,
    );
    const variants = buildQueryVariants({
      niche,
      location,
      constraints: String(args.constraints || "").trim() || null,
    });
    const mapsQueries = variants.slice(0, 4);
    const webQueries = variants.slice(2, 6);
    const seenNames = new Set<string>();

    const { withBrowserSession } = await import("@/lib/lead-agent/browser");
    const { scrapeGoogleMaps } = await import(
      "@/lib/lead-agent/sources/google-maps"
    );

    const payload = await withBrowserSession(
      async (session) => {
        const candidates: Array<Record<string, unknown>> = [];
        const evidence: Array<Record<string, unknown>> = [];
        const deadline = Date.now() + 150_000;

        for (const query of mapsQueries) {
          if (candidates.length >= maxCandidates || Date.now() > deadline) break;
          const remaining = Math.max(5, maxCandidates - candidates.length);
          const maps = await scrapeGoogleMaps(
            session.page,
            query,
            seenNames,
            (msg) => console.log(`[prospect_discovery] ${msg}`),
            Math.min(14, Math.max(5, Math.ceil(remaining / 5))),
            Math.min(remaining, 60),
            deadline,
          );
          evidence.push({
            source: "google_maps",
            query,
            count: maps.leads.length,
            blocked: maps.meta.blocked || null,
            empty_reason: maps.meta.empty_reason || null,
          });
          for (const lead of maps.leads) {
            candidates.push({
              business_name: lead.business_name,
              address: lead.address,
              phone: lead.phone,
              website_url: lead.website_url,
              google_maps_url: lead.google_maps_url,
              rating: lead.rating,
              review_count: lead.review_count,
              category: lead.description,
              source: "google_maps",
              source_query: query,
            });
          }
        }

        for (const query of webQueries) {
          if (candidates.length >= maxCandidates || Date.now() > deadline) break;
          const web = await searchWebWithBrowser(session.page, query, 8, "google");
          evidence.push({
            source: `web_${web.provider}`,
            query,
            count: web.results.length,
          });
          for (const r of web.results) {
            const title = r.title.replace(/\s[-|–].*$/, "").trim();
            if (!title) continue;
            candidates.push({
              business_name: title,
              address: location,
              website_url: r.url,
              google_maps_url: null,
              snippet: r.snippet,
              source: `web_${web.provider}`,
              source_query: query,
            });
          }
        }

        return {
          niche,
          location,
          queries: { maps: mapsQueries, web: webQueries },
          candidates: uniqueByBusinessKey(candidates).slice(0, maxCandidates),
          evidence,
        };
      },
      { orgId: context.orgId, attempts: 8 },
    );

    if (context.sessionId && payload.candidates.length > 0) {
      let persisted: { workspace_count: number; skipped_rejected: number } | null = null;
      try {
        const db = getAgentDb();
        await db.from("agent_discovery_snapshots").insert({
          session_id: context.sessionId,
          query: `${niche} ${location}`.slice(0, 500),
          lead_count: payload.candidates.length,
          payload,
        });
        await db.from("agent_memory").upsert(
          {
            session_id: context.sessionId,
            key: "v1_discovery_latest",
            value: payload,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "session_id,key" },
        );
        persisted = await persistDiscoveredCandidates(context.sessionId, payload, target);
      } catch (e) {
        console.warn(
          "[prospect_discovery] snapshot:",
          e instanceof Error ? e.message : e,
        );
      }
      return {
        ...payload,
        count: payload.candidates.length,
        auto_persisted: Boolean(persisted),
        workspace_count: persisted?.workspace_count || null,
        skipped_rejected: persisted?.skipped_rejected || 0,
        guidance:
          "Candidates were persisted to prospect_list automatically. Use prospect_list status/list, then call business_research for promising businesses before saving/exporting complete rows.",
      };
    }

    return {
      ...payload,
      count: payload.candidates.length,
      guidance:
        "Pre-filter this pool, then call business_research for promising businesses before saving via prospect_list.",
    };
  },
);
