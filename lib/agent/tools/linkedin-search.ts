import { registerTool } from "../tool-registry";
import { searchLinkedIn } from "@/lib/lead-agent/sources/linkedin";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";

registerTool(
  {
    name: "linkedin_profile_search",
    description:
      "Search for a business owner's LinkedIn profile via Google. Returns LinkedIn URL, owner name, email, phone, headline, summary.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
      owner_name: { type: "string", description: "Owner name if known (optional)", required: false },
    },
    required: ["business_name", "location"],
    costEstimateCents: 2,
  },
  async (args, context: AgentContext) => {
    const log = (msg: string) => console.log(`[linkedin] ${msg}`);
    return withBrowserSession(
      async (session) =>
        searchLinkedIn(
          session.page,
          args.business_name as string,
          args.location as string,
          (args.owner_name as string) || null,
          log,
        ),
      { orgId: context.orgId, attempts: 8 },
    );
  },
);
