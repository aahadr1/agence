/**
 * web_search — Tavily search wrapper (if TAVILY_API_KEY set),
 * otherwise a DuckDuckGo HTML fallback.
 */

import { registerTool } from "../tool-registry";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

async function tavilySearch(
  query: string,
  count: number,
): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) throw new Error("TAVILY_API_KEY not set");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: Math.min(count, 10),
      search_depth: "basic",
      include_answer: false,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Tavily error ${res.status}`);
  const json = (await res.json()) as { results?: TavilyResult[] };
  return json.results || [];
}

async function ddgSearch(
  query: string,
  count: number,
): Promise<TavilyResult[]> {
  // DuckDuckGo HTML fallback — no key required
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const out: TavilyResult[] = [];
  const re =
    /<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && out.length < count) {
    out.push({
      url: decodeURIComponent(m[1].replace(/^\/\/duckduckgo\.com\/l\/\?uddg=/, "")),
      title: m[2].trim(),
      content: m[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

registerTool(
  {
    name: "web_search",
    description:
      "Search the web and return a list of results with title, url, and short snippet. Uses Tavily when TAVILY_API_KEY is set, otherwise falls back to DuckDuckGo. Follow up with web_fetch on the most relevant URLs.",
    parameters: {
      query: { type: "string", description: "Search query" },
      count: {
        type: "number",
        description: "Max results (default 5, max 10)",
        required: false,
      },
    },
    required: ["query"],
    costEstimateCents: 0,
  },
  async (args) => {
    const query = String(args.query).slice(0, 500);
    const count = Math.min(Number(args.count) || 5, 10);
    let results: TavilyResult[] = [];
    if (process.env.TAVILY_API_KEY) {
      try {
        results = await tavilySearch(query, count);
      } catch (err) {
        results = await ddgSearch(
          query,
          count,
        );
        return {
          query,
          provider: "duckduckgo",
          results,
          note: `tavily failed: ${(err as Error).message}`,
        };
      }
      return { query, provider: "tavily", results };
    }
    results = await ddgSearch(query, count);
    return { query, provider: "duckduckgo", results };
  },
);
