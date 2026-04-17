/**
 * web_fetch — fast HTTP GET + HTML-to-markdown conversion. Prefer this over
 * agentic_browse for static pages (faster + cheaper, no Playwright).
 */

import { registerTool } from "../tool-registry";

function htmlToText(html: string): string {
  // Remove scripts, styles, and common noise
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");

  // Convert common block elements to newlines
  s = s
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|hr)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s;
}

registerTool(
  {
    name: "web_fetch",
    description:
      "Fetch a URL and return its text content (HTML auto-stripped to plain text). Use for static pages, docs, articles, contact pages. Does NOT run JavaScript — use agentic_browse_start for dynamic or logged-in pages.",
    parameters: {
      url: { type: "string", description: "Absolute URL to fetch" },
      max_chars: {
        type: "number",
        description: "Max chars to return (default 12000)",
        required: false,
      },
    },
    required: ["url"],
    costEstimateCents: 0,
  },
  async (args) => {
    const url = String(args.url);
    const maxChars = Number(args.max_chars) || 12000;
    if (!/^https?:\/\//i.test(url)) {
      throw new Error("web_fetch requires an absolute http(s) URL");
    }

    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(15000),
    });

    const status = res.status;
    const contentType = res.headers.get("content-type") || "";
    const raw = await res.text();

    let body: string;
    if (contentType.includes("html")) {
      body = htmlToText(raw);
    } else {
      body = raw;
    }

    if (body.length > maxChars) {
      body = body.slice(0, maxChars) + "\n...(truncated)";
    }

    return {
      url,
      status,
      content_type: contentType,
      content: body,
      length: body.length,
    };
  },
);
