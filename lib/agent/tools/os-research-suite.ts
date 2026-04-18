/**
 * Research façade: map space fast, rank, compare claims, build citations (JSON-first).
 */

import { getTool, registerTool } from "../tool-registry";
import type { AgentContext } from "../types";

type SearchHit = { title: string; url: string; snippet: string };

function rankHits(hits: SearchHit[]): SearchHit[] {
  const trusted = /gov\.fr|gouv|wikipedia|edu|openai|anthropic|vercel|github/i;
  return [...hits].sort((a, b) => {
    const ta = trusted.test(a.url) ? 1 : 0;
    const tb = trusted.test(b.url) ? 1 : 0;
    if (tb !== ta) return tb - ta;
    return (b.snippet?.length || 0) - (a.snippet?.length || 0);
  });
}

registerTool(
  {
    name: "research_suite",
    description:
      "Façade recherche. Actions: search | rank_sources | compare_claims | build_citations. " +
      "`search` appelle web_search. `rank_sources` attend { sources: [{title,url,snippet}] }. " +
      "`compare_claims` attend { claims: string[] }. `build_citations` attend sources + claims.",
    parameters: {
      action: {
        type: "string",
        description: "search | rank_sources | compare_claims | build_citations",
        enum: ["search", "rank_sources", "compare_claims", "build_citations"],
      },
      query: { type: "string", description: "search: requête", required: false },
      count: { type: "number", description: "search: nombre max", required: false },
      sources: {
        type: "array",
        description: "rank/build: liste {title,url,snippet}",
        required: false,
      },
      claims: {
        type: "array",
        description: "compare/build: liste de claims texte",
        required: false,
      },
    },
    required: ["action"],
    costEstimateCents: 1,
    riskLevel: "green",
  },
  async (args, context: AgentContext) => {
    const action = String(args.action || "").toLowerCase();
    switch (action) {
      case "search": {
        const q = String(args.query || "").trim();
        if (!q) throw new Error("search requires query");
        const t = getTool("web_search");
        if (!t) throw new Error("web_search unavailable");
        return t.execute(
          { query: q, count: args.count ?? 8 },
          context,
        ) as Promise<unknown>;
      }
      case "rank_sources": {
        const raw = args.sources as unknown;
        if (!Array.isArray(raw)) throw new Error("rank_sources requires sources[]");
        const hits = raw
          .filter((x) => x && typeof x === "object")
          .map((x) => x as Record<string, unknown>)
          .map((x) => ({
            title: String(x.title || ""),
            url: String(x.url || ""),
            snippet: String(x.snippet || ""),
          }))
          .filter((h) => h.url);
        const ranked = rankHits(hits);
        return {
          ranked,
          scores: ranked.map((h, i) => ({
            url: h.url,
            trust_hint: /gov\.fr|wikipedia|github/i.test(h.url) ? "high" : "normal",
            order: i + 1,
          })),
        };
      }
      case "compare_claims": {
        const claims = args.claims as unknown;
        if (!Array.isArray(claims) || claims.length < 2) {
          throw new Error("compare_claims requires claims[] with at least 2 strings");
        }
        const norm = (s: string) =>
          s
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s]/g, " ")
            .trim();
        const words = claims.map((c) => new Set(norm(String(c)).split(/\s+/).filter((w) => w.length > 3)));
        let overlap = 0;
        const [a, b] = [words[0], words[1]];
        for (const w of a) {
          if (b.has(w)) overlap++;
        }
        const union = new Set([...a, ...b]);
        const score = union.size ? overlap / union.size : 0;
        return {
          similarity: Math.round(score * 100) / 100,
          note: "Heuristique lexicale simple — compléter avec lecture de sources pour décision métier.",
        };
      }
      case "build_citations": {
        const raw = args.sources as unknown;
        const claimList = args.claims as unknown;
        if (!Array.isArray(raw) || !Array.isArray(claimList)) {
          throw new Error("build_citations requires sources[] and claims[]");
        }
        const ranked = rankHits(
          raw
            .filter((x) => x && typeof x === "object")
            .map((x) => x as Record<string, unknown>)
            .map((x) => ({
              title: String(x.title || ""),
              url: String(x.url || ""),
              snippet: String(x.snippet || ""),
            }))
            .filter((h) => h.url),
        );
        const citations = claimList.map((c, i) => ({
          claim: String(c),
          suggested_source_index: Math.min(i, ranked.length - 1),
          url: ranked[Math.min(i, ranked.length - 1)]?.url || null,
        }));
        return { citations, sources: ranked.slice(0, 15) };
      }
      default:
        throw new Error(`unknown action: ${action}`);
    }
  },
);
