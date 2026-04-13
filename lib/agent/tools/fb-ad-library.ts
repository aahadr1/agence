import { registerTool } from "../tool-registry";
import { checkFbAdLibrary } from "@/lib/lead-agent/sources/fb-ad-library";
import { launchBrowser, safeClose } from "@/lib/lead-agent/browser";

registerTool(
  {
    name: "fb_ad_library_check",
    description:
      "Check Meta Ad Library for active ads by a business. Returns whether ads exist and the count.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
      facebook_url: { type: "string", description: "Facebook page URL (optional)", required: false },
    },
    required: ["business_name", "location"],
    costEstimateCents: 2,
  },
  async (args) => {
    const log = (msg: string) => console.log(`[ad_library] ${msg}`);
    const session = await launchBrowser();
    try {
      return await checkFbAdLibrary(
        session.page,
        args.business_name as string,
        args.location as string,
        (args.facebook_url as string) || null,
        log
      );
    } finally {
      await safeClose(session);
    }
  }
);
