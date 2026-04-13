import { registerTool } from "../tool-registry";
import { scrapContactPage } from "@/lib/lead-agent/enrichment/contact-page-scraper";
import { launchBrowser, safeClose } from "@/lib/lead-agent/browser";

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
  async (args) => {
    const log = (msg: string) => console.log(`[contact_page] ${msg}`);
    const session = await launchBrowser();
    try {
      return await scrapContactPage(
        session.page,
        args.url as string,
        args.business_name as string,
        log
      );
    } finally {
      await safeClose(session);
    }
  }
);
