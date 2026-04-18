import { registerTool } from "../tool-registry";
import { deepCheckWebsite, fetchPageSpeedScore } from "@/lib/lead-agent/enrichment/deep-website-check";
import { quickHttpCheck } from "@/lib/lead-agent/enrichment/quick-http-check";
import { withBrowserSession } from "@/lib/lead-agent/browser";
import type { AgentContext } from "../types";

registerTool(
  {
    name: "website_audit",
    description:
      "Full website audit: HTTP check, HTTPS, mobile-friendly, performance, booking, chatbot detection, quality score. Combines PageSpeed and deep Playwright analysis.",
    parameters: {
      url: { type: "string", description: "Website URL to audit" },
      business_name: { type: "string", description: "Business name for context" },
    },
    required: ["url", "business_name"],
    costEstimateCents: 3,
  },
  async (args, context: AgentContext) => {
    const log = (msg: string) => console.log(`[website_audit] ${msg}`);
    const url = args.url as string;

    const httpCheck = await quickHttpCheck(url, log).catch(() => null);

    if (httpCheck && !httpCheck.is_alive) {
      return { alive: false, url, ...httpCheck };
    }

    return withBrowserSession(
      async (session) => {
        const [deep, pageSpeed] = await Promise.all([
          deepCheckWebsite(
            session.page,
            url,
            args.business_name as string,
            log,
          ).catch(() => null),
          fetchPageSpeedScore(url, log).catch(() => null),
        ]);

        return {
          alive: true,
          url,
          httpCheck,
          quality: deep?.quality,
          score: deep?.score,
          has_https: deep?.has_https ?? httpCheck?.has_https,
          has_booking: deep?.has_booking,
          has_chatbot: deep?.has_chatbot,
          is_just_social: deep?.is_just_social,
          pageSpeedScore: pageSpeed,
        };
      },
      { orgId: context.orgId, attempts: 8 },
    );
  },
);
