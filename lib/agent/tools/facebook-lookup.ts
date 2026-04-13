import { registerTool } from "../tool-registry";
import { searchFacebook } from "@/lib/lead-agent/sources/facebook";
import { launchBrowser, safeClose } from "@/lib/lead-agent/browser";

registerTool(
  {
    name: "facebook_page_lookup",
    description:
      "Find a business's Facebook page. Returns Facebook URL, phone, email, Instagram URL, follower count, owner name, address, website URL.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
      owner_name: { type: "string", description: "Owner name if known (optional)", required: false },
    },
    required: ["business_name", "location"],
    costEstimateCents: 2,
  },
  async (args) => {
    const log = (msg: string) => console.log(`[facebook] ${msg}`);
    const session = await launchBrowser();
    try {
      return await searchFacebook(
        session.page,
        args.business_name as string,
        args.location as string,
        (args.owner_name as string) || null,
        log
      );
    } finally {
      await safeClose(session);
    }
  }
);
