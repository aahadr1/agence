import { registerTool } from "../tool-registry";
import type { AgentContext } from "../types";
import { getAgentDb } from "./_db";
import {
  buildQueryVariants,
  searchWebWithBrowser,
  uniqueByBusinessKey,
} from "./v1-browser-utils";

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
      } catch (e) {
        console.warn(
          "[prospect_discovery] snapshot:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    return {
      ...payload,
      count: payload.candidates.length,
      guidance:
        "Pre-filter this pool, then call business_research for promising businesses before saving via prospect_list.",
    };
  },
);
