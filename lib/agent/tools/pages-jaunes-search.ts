import { registerTool } from "../tool-registry";
import { searchPagesJaunes } from "@/lib/lead-agent/sources/pages-jaunes";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";
import { findWorksetItemByTitle } from "../workset-state";

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
    let phone = (args.phone as string) || null;
    if (context.sessionId && !phone) {
      try {
        const item = await findWorksetItemByTitle(
          context.sessionId,
          args.business_name as string,
        );
        phone = typeof item?.facts.phone === "string" ? item.facts.phone : null;
      } catch {
        /* workset lookup is best-effort */
      }
    }
    return withBrowserSession(
      async (session) =>
        searchPagesJaunes(
          session.page,
          args.business_name as string,
          args.location as string,
          phone,
          log,
        ),
      { orgId: context.orgId, attempts: 8 },
    );
  },
);
