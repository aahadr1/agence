import { registerTool } from "../tool-registry";
import { researchDirigeant } from "@/lib/lead-agent/enrichment/dirigeant-researcher";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";

registerTool(
  {
    name: "dirigeant_research",
    description:
      "Deep research to find the owner/decision-maker of a business. Searches Google, LinkedIn, mentions legales. Returns owner name, role, phone, email, LinkedIn URL.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
      owner_name: { type: "string", description: "Owner name if partially known (optional)", required: false },
      niche: { type: "string", description: "Business niche/sector (optional)", required: false },
    },
    required: ["business_name", "location"],
    costEstimateCents: 5,
  },
  async (args, context: AgentContext) => {
    const log = (msg: string) => console.log(`[dirigeant] ${msg}`);
    return withBrowserSession(
      async (session) =>
        researchDirigeant(
          session.page,
          (args.owner_name as string) || null,
          args.business_name as string,
          args.location as string,
          (args.niche as string) || null,
          log,
        ),
      { orgId: context.orgId, attempts: 8 },
    );
  },
);
