import { askGeminiText } from "./browser";

export interface ExpandedQueries {
  queries: string[];
  keywords: string[];
}

/**
 * Uses Gemini to generate search variations from a niche + location.
 * Returns 4-6 query variations to maximize business discovery.
 */
export async function expandQueries(
  niche: string,
  location: string,
  excludeNames: string[] = []
): Promise<ExpandedQueries> {
  const excludeClause =
    excludeNames.length > 0
      ? `\n\nBusinesses to EXCLUDE (already found): ${excludeNames.slice(0, 50).join(", ")}`
      : "";

  const prompt = `You are a lead generation expert. Given a business niche and location, generate search query variations to find the MAXIMUM number of different businesses on Google Maps.

Niche: "${niche}"
Location: "${location}"${excludeClause}

Generate 5-7 search queries that would find different businesses. Think about:
- Synonyms and related business types (e.g., "pizzeria" → also "pizza", "restaurant italien", "trattoria")
- Specific neighborhoods or nearby areas within the location
- Different phrasing that Google Maps responds to differently
- More specific sub-niches that might surface hidden businesses

Also extract the core keywords for future reference.

Return JSON only:
{
  "queries": ["query 1 for google maps", "query 2", ...],
  "keywords": ["keyword1", "keyword2", ...]
}

Make the queries natural — they will be typed into Google Maps search. Include the location in each query.`;

  try {
    const text = await askGeminiText(prompt);
    let jsonStr = text;
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    const result = JSON.parse(jsonStr) as ExpandedQueries;
    // Always include the original query
    const originalQuery = `${niche} in ${location}`;
    if (!result.queries.includes(originalQuery)) {
      result.queries.unshift(originalQuery);
    }
    return result;
  } catch {
    // Fallback: generate basic variations
    return {
      queries: [
        `${niche} in ${location}`,
        `${niche} ${location}`,
        `best ${niche} ${location}`,
      ],
      keywords: [niche, location],
    };
  }
}
