import { registerTool } from "../tool-registry";
import { scrapeGoogleMaps } from "@/lib/lead-agent/sources/google-maps";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";
import { persistGoogleMapsSearchResult } from "../google-maps-persistence";

registerTool(
  {
    name: "google_maps_search",
    description:
      "Search Google Maps for businesses. Returns a list of businesses with name, address, phone, rating, review count, website URL, Google Maps URL.",
    parameters: {
      query: {
        type: "string",
        description: "Search query (e.g. 'pizzerias Lyon', 'plombier Marseille')",
      },
      max_results: {
        type: "number",
        description: "Maximum businesses to return (default 30, hard cap 60 — raise scroll budget automatically for large values)",
        required: false,
      },
      target_pool_size: {
        type: "number",
        description:
          "When you need ~N qualified leads later, pass N here: the server widens scroll budget toward min(60, ~3×N). Combine with max_results.",
        required: false,
      },
    },
    required: ["query"],
    costEstimateCents: 3,
  },
  async (args, context: AgentContext) => {
    const log = (msg: string) => console.log(`[google_maps] ${msg}`);
    const seenNames = new Set<string>();
    const rawMax = Number(args.max_results);
    const rawTarget = Number(args.target_pool_size);
    let maxResults = Math.min(
      60,
      Math.max(1, Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 30),
    );
    if (Number.isFinite(rawTarget) && rawTarget > 0) {
      const floor = Math.min(60, Math.ceil(rawTarget * 3));
      maxResults = Math.min(60, Math.max(maxResults, floor));
    }
    const minFromRuntime = context.leadGenDiscoveryMinResults;
    if (typeof minFromRuntime === "number" && minFromRuntime > 0) {
      maxResults = Math.min(
        60,
        Math.max(maxResults, Math.min(60, Math.floor(minFromRuntime))),
      );
    }
    const maxScrolls = Math.min(14, Math.max(4, Math.ceil(maxResults / 5)));
    const deadline = Date.now() + 120_000;
    const primaryQuery = args.query as string;

    const payload = await withBrowserSession(
      async (session) => {
        const first = await scrapeGoogleMaps(
          session.page,
          primaryQuery,
          seenNames,
          log,
          maxScrolls,
          maxResults,
          deadline,
        );
        const leads = first.leads;
        const meta = first.meta;

        const widerUsed: string | null = null;

        return {
          count: leads.length,
          leads,
          blocked: Boolean(meta.blocked),
          error_code: meta.blocked ?? null,
          credential_required: meta.credential_required ?? false,
          empty_reason: meta.empty_reason ?? null,
          suggested_user_action_fr: meta.suggested_user_action_fr ?? null,
          credential_hostname: meta.credential_hostname ?? null,
          navigation_message: meta.navigation_message ?? null,
          secondary_query_used: widerUsed,
        };
      },
      { orgId: context.orgId, attempts: 8 },
    );

    if (
      process.env.AGENT_LOCAL_WORKER !== "1" &&
      context.sessionId &&
      payload &&
      !payload.blocked &&
      Array.isArray(payload.leads) &&
      payload.leads.length > 0
    ) {
      try {
        await persistGoogleMapsSearchResult({
          sessionId: context.sessionId,
          query: primaryQuery,
          maxResultsRequested: maxResults,
          targetCount:
            Number.isFinite(rawTarget) && rawTarget > 0
              ? Math.floor(rawTarget)
              : null,
          payload,
          scratchpad: context.scratchpad,
        });
      } catch (e) {
        console.warn(
          "[google_maps_search] snapshot insert:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    return payload;
  },
);
