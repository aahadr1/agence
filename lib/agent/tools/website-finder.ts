import { registerTool } from "../tool-registry";
import { findWebsite } from "@/lib/lead-agent/enrichment/website-finder";
import { launchBrowser, safeClose } from "@/lib/lead-agent/browser";

registerTool(
  {
    name: "website_finder",
    description:
      "Find and validate the real website URL for a business. Checks Google Maps link, does click-through, classifies platform sites vs real websites.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
      website_url: { type: "string", description: "Candidate URL to verify (optional)", required: false },
      google_maps_url: { type: "string", description: "Google Maps listing URL (optional)", required: false },
    },
    required: ["business_name", "location"],
    costEstimateCents: 3,
  },
  async (args) => {
    const log = (msg: string) => console.log(`[website_finder] ${msg}`);
    const session = await launchBrowser();
    try {
      return await findWebsite(
        session.page,
        args.business_name as string,
        args.location as string,
        (args.website_url as string) || null,
        log,
        (args.google_maps_url as string) || null
      );
    } finally {
      await safeClose(session);
    }
  }
);
