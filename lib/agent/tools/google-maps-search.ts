import { registerTool } from "../tool-registry";
import { scrapeGoogleMaps } from "@/lib/lead-agent/sources/google-maps";
import { launchBrowser, safeClose } from "@/lib/lead-agent/browser";

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
        description: "Maximum number of results to return (default 20)",
        required: false,
      },
    },
    required: ["query"],
    costEstimateCents: 3,
  },
  async (args) => {
    const log = (msg: string) => console.log(`[google_maps] ${msg}`);
    const session = await launchBrowser();
    const seenNames = new Set<string>();
    const maxResults = (args.max_results as number) || 20;
    const deadline = Date.now() + 120_000;
    try {
      const results = await scrapeGoogleMaps(
        session.page,
        args.query as string,
        seenNames,
        log,
        3,
        maxResults,
        deadline
      );
      return { count: results.length, leads: results };
    } finally {
      await safeClose(session);
    }
  }
);
