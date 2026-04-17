/**
 * web_fetch — Playwright-powered page read.
 *
 * We DELIBERATELY do NOT use raw `fetch()` here. Half the modern web is
 * SPA / JS-hydrated (think React marketing sites, LinkedIn, Instagram,
 * Pappers, Societe.com, most restaurant pages on Wix/Squarespace), and
 * raw HTTP returns a nearly-empty shell on those. This tool launches the
 * same headless Chromium used by the `browser_*` tools so we always see
 * what a human sees.
 *
 * Strategy:
 *   - Launch headless Chromium
 *   - Navigate with our stealth + consent handling (`safeGoto`)
 *   - Return the rendered page's `innerText` (already whitespace-normalized)
 *   - Optionally return the HTML if the caller asks for it
 *
 * Budget: each call is ~2-4s on a warm serverless instance. Use
 * `web_fetch` only on URLs you actually need to read. For quick SERP
 * scans, use `web_search` (also Playwright).
 */

import type { Page } from "playwright-core";
import { registerTool } from "../tool-registry";

async function extractText(
  page: Page,
  maxChars: number,
): Promise<{ text: string; html: string; title: string }> {
  const payload = await page.evaluate(() => {
    // Remove nav / footer / script / style / noscript before reading.
    const drop = [
      ...Array.from(document.querySelectorAll("script,style,noscript")),
      ...Array.from(document.querySelectorAll("nav,footer,aside")),
    ];
    for (const el of drop) el.remove();
    const text = (document.body?.innerText || "")
      .replace(/\s+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return {
      text,
      html: document.documentElement.outerHTML,
      title: document.title || "",
    };
  });
  return {
    text:
      payload.text.length > maxChars
        ? payload.text.slice(0, maxChars) + "\n...(truncated)"
        : payload.text,
    html: payload.html.length > maxChars * 3
      ? payload.html.slice(0, maxChars * 3) + "\n<!-- truncated -->"
      : payload.html,
    title: payload.title,
  };
}

registerTool(
  {
    name: "web_fetch",
    description:
      "Fetch a URL through a real headless browser (Playwright) and return its fully-rendered text content. Handles SPAs, JS-hydrated pages, cookie consent, and French locales. Use for any external page you need to read — static docs, article pages, contact pages, Pappers, Societe.com, LinkedIn pages, etc. For multi-step interactions (click, type, scroll), use `browser_navigate` + `browser_act` instead.",
    parameters: {
      url: { type: "string", description: "Absolute http(s) URL to fetch" },
      max_chars: {
        type: "number",
        description: "Max text chars to return (default 12000, max 40000)",
        required: false,
      },
      include_html: {
        type: "boolean",
        description:
          "If true, also include raw HTML (truncated). Off by default to save tokens.",
        required: false,
      },
    },
    required: ["url"],
    costEstimateCents: 1,
  },
  async (args) => {
    const url = String(args.url);
    const maxChars = Math.min(Math.max(Number(args.max_chars) || 12000, 500), 40000);
    const includeHtml = Boolean(args.include_html);

    if (!/^https?:\/\//i.test(url)) {
      throw new Error("web_fetch requires an absolute http(s) URL");
    }

    const { launchBrowser, closeBrowser, safeGoto, isCaptchaPage } =
      await import("@/lib/lead-agent/browser");

    const session = await launchBrowser();
    try {
      const page = session.page;
      const loaded = await safeGoto(page, url);
      const finalUrl = page.url();
      if (!loaded) {
        return {
          url,
          final_url: finalUrl,
          status: null,
          content_type: null,
          content: "",
          length: 0,
          note: "navigation failed or timed out",
        };
      }
      if (await isCaptchaPage(page)) {
        return {
          url,
          final_url: finalUrl,
          status: null,
          content_type: null,
          content: "",
          length: 0,
          note: "captcha or interstitial detected — page not readable",
        };
      }

      const { text, html, title } = await extractText(page, maxChars);

      return {
        url,
        final_url: finalUrl,
        title,
        content_type: "text/html",
        content: text,
        length: text.length,
        ...(includeHtml ? { html } : {}),
      };
    } finally {
      await closeBrowser(session);
    }
  },
);
