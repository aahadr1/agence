/**
 * Cheap batch HTTP checks (no Playwright). Use after you already have URLs
 * (e.g. from Maps / PJ) to filter dead sites or missing HTTPS before expensive audits.
 */

import { registerTool } from "../tool-registry";
import { quickHttpCheck } from "@/lib/lead-agent/enrichment/quick-http-check";

const MAX_URLS = 20;
const MAX_URL_LENGTH = 2048;
const CONCURRENCY = 8;

const noop = () => {};

export type WebsiteCheckRow =
  | {
      url: string;
      is_alive: boolean;
      has_https: boolean;
      final_url: string | null;
      redirected_to_other_domain?: boolean;
    }
  | { input: string; error: string };

/** Exported for tests / reuse by other tools. */
export function classifyWebsiteCheckInput(
  raw: string,
):
  | { ok: true; url: string }
  | { ok: false; input: string; error: string }
  | null {
  const u = raw.trim();
  if (!u) return null;
  const lower = u.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:")) {
    return { ok: false, input: raw, error: "blocked_scheme" };
  }
  if (u.length > MAX_URL_LENGTH) {
    return { ok: false, input: raw.slice(0, 80) + "…", error: "url_too_long" };
  }
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(u) &&
    !/^https?:\/\//i.test(u)
  ) {
    return { ok: false, input: raw, error: "unsupported_protocol" };
  }
  try {
    const parsed = new URL(u.startsWith("http") ? u : `https://${u}`);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, input: raw, error: "unsupported_protocol" };
    }
    const host = parsed.hostname.toLowerCase();
    if (!host || host === "localhost") {
      return { ok: false, input: raw, error: "invalid_host" };
    }
    return { ok: true, url: parsed.toString() };
  } catch {
    return { ok: false, input: raw, error: "invalid_url" };
  }
}

registerTool(
  {
    name: "batch_website_check",
    description:
      "Run fast HEAD/GET checks on up to 20 URLs per call in parallel (no browser). " +
      "Each input must be http(s) or a hostname; `javascript:` / `data:` are rejected. " +
      "If you have more than 20 URLs, call this tool multiple times (chunks of 20). " +
      "Returns one row per URL: either HTTP check fields or `{ input, error }` for invalid entries.",
    parameters: {
      urls: {
        type: "array",
        items: { type: "string" },
        description:
          "List of absolute URLs or hostnames; max 20 rows total per call (errors + checks); invalid rows still appear in `checks` with an `error` field",
      },
    },
    required: ["urls"],
    costEstimateCents: 1,
  },
  async (args) => {
    const raw = args.urls as unknown;
    if (!Array.isArray(raw)) throw new Error("urls must be an array");

    const errorRows: WebsiteCheckRow[] = [];
    const pendingHttp: string[] = [];
    const seen = new Set<string>();

    for (const x of raw) {
      if (errorRows.length + pendingHttp.length >= MAX_URLS) break;
      const c = classifyWebsiteCheckInput(String(x));
      if (!c) continue;
      if (!c.ok) {
        errorRows.push({ input: c.input, error: c.error });
        continue;
      }
      const key = c.url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pendingHttp.push(c.url);
    }

    if (errorRows.length === 0 && pendingHttp.length === 0) {
      return { checks: [], count: 0, error: "no valid urls" };
    }

    const checks: WebsiteCheckRow[] = [...errorRows];

    for (let i = 0; i < pendingHttp.length; i += CONCURRENCY) {
      const chunk = pendingHttp.slice(i, i + CONCURRENCY);
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
