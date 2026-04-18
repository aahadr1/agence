import { registerTool } from "../tool-registry";
import { searchPagesJaunes } from "@/lib/lead-agent/sources/pages-jaunes";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";

registerTool(
  {
    name: "pages_jaunes_search",
    description:
      "Search Pages Jaunes (French yellow pages) for businesses. Returns phone, email, address, owner name, website URL.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
      phone: { type: "string", description: "Known phone number to help match (optional)", required: false },
    },
    required: ["business_name", "location"],
    costEstimateCents: 2,
  },
  async (args, context: AgentContext) => {
    const log = (msg: string) => console.log(`[pages_jaunes] ${msg}`);
    return withBrowserSession(
      async (session) =>
        searchPagesJaunes(
          session.page,
          args.business_name as string,
          args.location as string,
          (args.phone as string) || null,
          log,
        ),
      { orgId: context.orgId, attempts: 8 },
    );
  },
);
