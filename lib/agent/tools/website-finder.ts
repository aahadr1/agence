import { registerTool } from "../tool-registry";
import { findWebsite } from "@/lib/lead-agent/enrichment/website-finder";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";

registerTool(
  {
    name: "website_finder",
    description:
      "Find and validate the real website URL for a business. Checks Google Maps link, does click-through, classifies platform sites vs real websites.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
      website_url: {
        type: "string",
        description:
          "Website URL from Maps or elsewhere when you already have one — pass through for verification (optional)",
        required: false,
      },
      google_maps_url: {
        type: "string",
        description:
          "Strongly recommended whenever available after google_maps_search: the place's Maps URL improves matching and avoids false 'no website' conclusions (optional but prefer passing it).",
        required: false,
      },
    },
    required: ["business_name", "location"],
    costEstimateCents: 3,
  },
  async (args, context: AgentContext) => {
    const log = (msg: string) => console.log(`[website_finder] ${msg}`);
    return withBrowserSession(
      async (session) =>
        findWebsite(
          session.page,
          args.business_name as string,
          args.location as string,
          (args.website_url as string) || null,
          log,
          (args.google_maps_url as string) || null,
        ),
      { orgId: context.orgId, attempts: 8 },
    );
  },
);
