import { registerTool } from "../tool-registry";
import { searchGoogle } from "@/lib/lead-agent/sources/google-search";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";

registerTool(
  {
    name: "google_search",
    description:
      "Search Google for a business to find phone, email, owner name, social media URLs, website, and description.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
      phone: { type: "string", description: "Known phone (optional)", required: false },
      address: { type: "string", description: "Known address (optional)", required: false },
    },
    required: ["business_name", "location"],
    costEstimateCents: 2,
  },
  async (args, context: AgentContext) => {
    const log = (msg: string) => console.log(`[google_search] ${msg}`);
    return withBrowserSession(
      async (session) =>
        searchGoogle(
          session.page,
          args.business_name as string,
          args.location as string,
          (args.phone as string) || null,
          (args.address as string) || null,
          log,
        ),
      { orgId: context.orgId, attempts: 8 },
    );
  },
);
