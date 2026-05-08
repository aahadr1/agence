import { tool } from "@opencode-ai/plugin";
import { fetchJson } from "./_shared";

interface PageSpeedResponse {
  lighthouseResult?: {
    categories?: {
      performance?: { score?: number };
      accessibility?: { score?: number };
      "best-practices"?: { score?: number };
      seo?: { score?: number };
    };
  };
}

export default tool({
  description:
    "Score Google Lighthouse via l'API PageSpeed Insights (gratuit 25k req/jour). Retourne perf/accessibilité/SEO 0-100 sur mobile.",
  args: {
    url: tool.schema.string().url(),
    strategy: tool.schema.enum(["mobile", "desktop"]).default("mobile"),
  },
  async execute(args) {
    const apiKey = process.env.PAGESPEED_API_KEY?.trim();
    const params = new URLSearchParams({
      url: args.url,
      strategy: args.strategy,
    });
    if (apiKey) params.set("key", apiKey);
    params.append("category", "performance");
    params.append("category", "accessibility");
    params.append("category", "seo");

    const r = await fetchJson<PageSpeedResponse>(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`,
      { timeoutMs: 60_000 },
    );
    if (!r.ok) return { error: r.error, http_status: r.status };

    const cats = r.data.lighthouseResult?.categories;
    return {
      performance: Math.round((cats?.performance?.score ?? 0) * 100),
      accessibility: Math.round((cats?.accessibility?.score ?? 0) * 100),
      best_practices: Math.round((cats?.["best-practices"]?.score ?? 0) * 100),
      seo: Math.round((cats?.seo?.score ?? 0) * 100),
    };
  },
});
