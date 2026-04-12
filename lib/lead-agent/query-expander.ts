import { askGeminiText } from "./browser";

export interface ExpandedQueries {
  queries: string[];
  keywords: string[];
}

export interface ExpandQueryOptions {
  attemptedQueries?: string[];
  attemptedKeywords?: string[];
  minQueries?: number;
}

/**
 * Uses Gemini to generate search variations from a niche + location.
 * Returns 4-6 query variations to maximize business discovery.
 */
export async function expandQueries(
  niche: string,
  location: string,
  excludeNames: string[] = [],
  options: ExpandQueryOptions = {}
): Promise<ExpandedQueries> {
  const minQueries = Math.max(8, options.minQueries || 10);
  const excludeClause =
    excludeNames.length > 0
      ? `\n\nBusinesses to EXCLUDE (already found): ${excludeNames.slice(0, 50).join(", ")}`
      : "";
  const attemptedQueriesClause =
    options.attemptedQueries && options.attemptedQueries.length > 0
      ? `\nPreviously used queries to avoid repeating: ${options.attemptedQueries
          .slice(0, 100)
          .join(" | ")}`
      : "";
  const attemptedKeywordsClause =
    options.attemptedKeywords && options.attemptedKeywords.length > 0
      ? `\nPreviously used keywords to avoid reusing unless absolutely necessary: ${options.attemptedKeywords
          .slice(0, 100)
          .join(", ")}`
      : "";

  const prompt = `You are a lead generation expert. Given a business niche and location, generate search query variations to find the MAXIMUM number of different businesses on Google Maps.

Niche: "${niche}"
Location: "${location}"${excludeClause}${attemptedQueriesClause}${attemptedKeywordsClause}

Generate at least ${minQueries} HIGHLY VARIED Google Maps queries that would find different businesses. Think about:
- Synonyms and related business types (e.g., "pizzeria" -> also "pizza", "restaurant italien", "trattoria")
- Specific neighborhoods, districts, nearby towns, or postal-code variants within the location
- Different phrasing that Google Maps responds to differently
- More specific sub-niches that might surface hidden businesses
- French and English wording if that helps surface more results
- Variants using trade names vs legal-style wording when relevant

Also extract the core keywords used to build those queries for future reference.

Rules:
- Every query must include a location hint.
- Do NOT repeat the previously used queries.
- Prefer new keyword combinations over cosmetic rewrites.
- Queries should be suitable for pasting directly into Google Maps.
- Keep only queries that are genuinely likely to surface additional businesses.

Return JSON only:
{
  "queries": ["query 1 for google maps", "query 2", ...],
  "keywords": ["keyword1", "keyword2", ...]
}
`;

  try {
    const text = await askGeminiText(prompt);
    let jsonStr = text;
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const result = JSON.parse(jsonStr) as ExpandedQueries;
    const originalQueries = [
      `${niche} in ${location}`,
      `${niche} ${location}`,
    ];
    const queries = uniqueStrings([...originalQueries, ...(result.queries || [])]);
    const keywords = uniqueStrings([
      niche,
      location,
      ...(options.attemptedKeywords || []),
      ...(result.keywords || []),
    ]).filter((keyword) => !matchesIgnored(keyword, options.attemptedKeywords || []));

    return {
      queries: queries.filter(
        (query) => !matchesIgnored(query, options.attemptedQueries || [])
      ),
      keywords,
    };
  } catch {
    // Fallback: generate basic variations
    return {
      queries: uniqueStrings([
        `${niche} in ${location}`,
        `${niche} ${location}`,
        `best ${niche} ${location}`,
        `${niche} proximité ${location}`,
        `${niche} centre ${location}`,
      ]).filter(
        (query) => !matchesIgnored(query, options.attemptedQueries || [])
      ),
      keywords: uniqueStrings([niche, location]).filter(
        (keyword) => !matchesIgnored(keyword, options.attemptedKeywords || [])
      ),
    };
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function matchesIgnored(value: string, ignored: string[]): boolean {
  const normalized = value.trim().toLowerCase();
  return ignored.some((item) => item.trim().toLowerCase() === normalized);
}
