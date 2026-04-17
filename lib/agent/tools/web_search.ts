/**
 * web_search — Playwright-powered SERP.
 *
 * We DELIBERATELY do NOT use Tavily here. Tavily's snippets are fast but
 * shallow (truncated text, no JS, no cookie-aware SERPs) and caused the
 * agent to hallucinate Pappers / Societe.com results from thin fragments
 * in the Nancy lead-gen incident.
 *
 * This tool launches headless Chromium (Sparticuz on Vercel, system
 * Chromium locally — same stack as the `browser_*` tools), queries a
 * real search engine, and returns titles + links + actual snippets
 * scraped from the rendered page.
 *
 * Strategy:
 *   1. Try Google (we ship consent cookies in `launchBrowser()` so we
 *      almost never hit the interstitial).
 *   2. If Google shows a CAPTCHA or interstitial, fall back to
 *      DuckDuckGo's HTML SERP (`https://duckduckgo.com/html/?q=…`),
 *      which tolerates scripted traffic much better.
 */

import type { Page } from "playwright-core";
import { registerTool } from "../tool-registry";

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function scrapeGoogle(
  page: Page,
  query: string,
  count: number,
): Promise<SearchResult[]> {
  const { safeGoto, isCaptchaPage } = await import("@/lib/lead-agent/browser");
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=${Math.min(
    count * 2,
    20,
  )}`;
  const ok = await safeGoto(page, url);
  if (!ok) return [];
  if (await isCaptchaPage(page)) return [];

  return page.evaluate((max) => {
    const out: Array<{ title: string; url: string; snippet: string }> = [];
    // Google SERP: each organic result is a div.g (or div[data-hveid]).
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>("div.g, div[data-hveid]"),
    );
    for (const b of blocks) {
      const a = b.querySelector<HTMLAnchorElement>("a[href^='http']");
      const h = b.querySelector("h3");
      if (!a || !h) continue;
      const href = a.href;
      if (!href || /google\./.test(new URL(href).hostname)) continue;
      // Snippet is usually under a div.VwiC3b or any span close to the title.
      const snippetNode =
        b.querySelector<HTMLElement>("div.VwiC3b") ||
        b.querySelector<HTMLElement>("[data-sncf]") ||
        b.querySelector<HTMLElement>("span");
      const snippet = (snippetNode?.innerText || "").replace(/\s+/g, " ").trim();
      const title = (h.innerText || "").trim();
      if (!title) continue;
      if (out.some((r) => r.url === href)) continue;
      out.push({ title, url: href, snippet });
      if (out.length >= max) break;
    }
    return out;
  }, count);
}

async function scrapeDuckDuckGo(
  page: Page,
  query: string,
  count: number,
): Promise<SearchResult[]> {
  const { safeGoto } = await import("@/lib/lead-agent/browser");
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const ok = await safeGoto(page, url);
  if (!ok) return [];

  return page.evaluate((max) => {
    const out: Array<{ title: string; url: string; snippet: string }> = [];
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>(".result, .result__body"),
    );
    for (const b of blocks) {
      const a = b.querySelector<HTMLAnchorElement>("a.result__a");
      const snippetNode = b.querySelector<HTMLElement>(".result__snippet");
      if (!a) continue;
      let href = a.href;
      // DDG wraps the real URL in a redirect; extract `uddg` if present.
      try {
        const u = new URL(href);
        const uddg = u.searchParams.get("uddg");
        if (uddg) href = uddg;
      } catch {
        /* keep as-is */
      }
      const title = (a.innerText || "").replace(/\s+/g, " ").trim();
      const snippet = (snippetNode?.innerText || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!title || !href) continue;
      if (out.some((r) => r.url === href)) continue;
      out.push({ title, url: href, snippet });
      if (out.length >= max) break;
    }
    return out;
  }, count);
}

registerTool(
  {
    name: "web_search",
    description:
      "Search the web with a real headless Chromium (Playwright). Returns structured results (title, url, snippet) scraped from a live SERP — not a snippet API. Handles JS-rendered pages, cookie consent, and French results out of the box. Follow up with `web_fetch` on the most relevant URLs.",
    parameters: {
      query: { type: "string", description: "Search query" },
      count: {
        type: "number",
        description: "Max results (default 8, max 15)",
        required: false,
      },
      engine: {
        type: "string",
        description:
          "Which engine to try first: 'google' (default) or 'duckduckgo'.",
        enum: ["google", "duckduckgo"],
        required: false,
      },
    },
    required: ["query"],
    costEstimateCents: 1,
  },
  async (args) => {
    const query = String(args.query).slice(0, 500);
    const count = Math.min(Math.max(Number(args.count) || 8, 1), 15);
    const preferred = (args.engine as string) === "duckduckgo"
      ? "duckduckgo"
      : "google";

    const { withBrowserSession } = await import("@/lib/lead-agent/browser");
    return withBrowserSession(async (session) => {
      const page = session.page;
      let results: SearchResult[] = [];
      let provider: "google" | "duckduckgo" = "google";

      if (preferred === "google") {
        results = await scrapeGoogle(page, query, count);
        if (results.length === 0) {
          results = await scrapeDuckDuckGo(page, query, count);
          provider = "duckduckgo";
        }
      } else {
        results = await scrapeDuckDuckGo(page, query, count);
        provider = "duckduckgo";
        if (results.length === 0) {
          results = await scrapeGoogle(page, query, count);
          provider = "google";
        }
      }

      return {
        query,
        provider,
        results,
        count: results.length,
      };
    });
  },
);
