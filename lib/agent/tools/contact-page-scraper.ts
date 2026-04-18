import { registerTool } from "../tool-registry";
import { scrapContactPage } from "@/lib/lead-agent/enrichment/contact-page-scraper";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";

registerTool(
  {
    name: "contact_page_scraper",
    description:
      "Scrape a business website's contact page for email and phone. Checks /contact, /nous-contacter, /mentions-legales.",
    parameters: {
      url: { type: "string", description: "Website URL" },
      business_name: { type: "string", description: "Business name for context" },
    },
    required: ["url", "business_name"],
    costEstimateCents: 2,
  },
  async (args, context: AgentContext) => {
    const log = (msg: string) => console.log(`[contact_page] ${msg}`);
    return withBrowserSession(
      async (session) =>
        scrapContactPage(
          session.page,
          args.url as string,
          args.business_name as string,
          log,
        ),
      { orgId: context.orgId, attempts: 8 },
    );
  },
);
