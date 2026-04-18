import { registerTool } from "../tool-registry";
import { scrapeGoogleMaps } from "@/lib/lead-agent/sources/google-maps";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";

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
    },
    required: ["query"],
    costEstimateCents: 3,
  },
  async (args, context: AgentContext) => {
    const log = (msg: string) => console.log(`[google_maps] ${msg}`);
    const seenNames = new Set<string>();
    const rawMax = Number(args.max_results);
    const maxResults = Math.min(
      60,
      Math.max(1, Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 30),
    );
    const maxScrolls = Math.min(14, Math.max(4, Math.ceil(maxResults / 5)));
    const deadline = Date.now() + 120_000;
    return withBrowserSession(
      async (session) => {
        const { leads, meta } = await scrapeGoogleMaps(
          session.page,
          args.query as string,
          seenNames,
          log,
          maxScrolls,
          maxResults,
          deadline,
        );
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
        };
      },
      { orgId: context.orgId, attempts: 8 },
    );
  },
);
