/**
 * Cheap batch HTTP checks (no Playwright). Use after you already have URLs
 * (e.g. from Maps / PJ) to filter dead sites or missing HTTPS before expensive audits.
 */

import { registerTool } from "../tool-registry";
import { quickHttpCheck } from "@/lib/lead-agent/enrichment/quick-http-check";

const MAX_URLS = 20;
const CONCURRENCY = 8;

const noop = () => {};

function normalizeInputUrl(raw: string): string | null {
  const u = raw.trim();
  if (!u) return null;
  try {
    const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
    return parsed.toString();
  } catch {
    return null;
  }
}

registerTool(
  {
    name: "batch_website_check",
    description:
      "Run fast HEAD/GET checks on up to 20 URLs in parallel (no browser). Returns alive/HTTPS/final_url per row — use to pre-filter broken or redirect-heavy sites before `website_audit` or heavy `website_finder` rounds.",
    parameters: {
      urls: {
        type: "array",
        items: { type: "string" },
        description: "List of absolute URLs (or hostnames); max 20, duplicates removed",
      },
    },
    required: ["urls"],
    costEstimateCents: 1,
  },
  async (args) => {
    const raw = args.urls as unknown;
    if (!Array.isArray(raw)) throw new Error("urls must be an array");
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const x of raw) {
      const n = normalizeInputUrl(String(x));
      if (!n) continue;
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      urls.push(n);
      if (urls.length >= MAX_URLS) break;
    }
    if (urls.length === 0) {
      return { checks: [], count: 0, error: "no valid urls" };
    }

    const checks: Array<{
      url: string;
      is_alive: boolean;
      has_https: boolean;
      final_url: string | null;
      redirected_to_other_domain?: boolean;
    }> = [];

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const chunk = urls.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map(async (url) => {
          const r = await quickHttpCheck(url, noop);
          if (!r) {
            return {
              url,
              is_alive: false,
              has_https: false,
              final_url: null as string | null,
            };
          }
          return {
            url,
            is_alive: r.is_alive,
            has_https: r.has_https,
            final_url: r.final_url,
            redirected_to_other_domain: r.redirected_to_other_domain,
          };
        }),
      );
      checks.push(...results);
    }

    return { checks, count: checks.length };
  },
);
