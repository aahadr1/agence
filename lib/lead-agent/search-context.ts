export const DEFAULT_EXPAND_TARGET = 12;

export interface LeadListSearchContext {
  niche: string | null;
  location: string | null;
  seed_query: string | null;
  keyword_history: string[];
  query_history: string[];
  attempted_queries: string[];
  attempted_keywords: string[];
  successful_queries: string[];
  last_generated_queries: string[];
  last_generated_keywords: string[];
  target_min_new_leads: number;
  expansion_count: number;
  last_run_added: number;
  last_expanded_at: string | null;
  updated_at: string | null;
}

type SearchContextPatch = Partial<LeadListSearchContext>;

function uniqueStrings(values: Array<string | null | undefined>): string[] {
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

export function createSearchContext(
  patch: SearchContextPatch = {}
): LeadListSearchContext {
  return {
    niche: patch.niche?.trim() || null,
    location: patch.location?.trim() || null,
    seed_query: patch.seed_query?.trim() || null,
    keyword_history: uniqueStrings(patch.keyword_history || patch.attempted_keywords || []),
    query_history: uniqueStrings(patch.query_history || patch.attempted_queries || []),
    attempted_queries: uniqueStrings(patch.attempted_queries || []),
    attempted_keywords: uniqueStrings(patch.attempted_keywords || []),
    successful_queries: uniqueStrings(patch.successful_queries || []),
    last_generated_queries: uniqueStrings(patch.last_generated_queries || []),
    last_generated_keywords: uniqueStrings(
      patch.last_generated_keywords || patch.attempted_keywords || []
    ),
    target_min_new_leads:
      patch.target_min_new_leads && patch.target_min_new_leads > 0
        ? patch.target_min_new_leads
        : DEFAULT_EXPAND_TARGET,
    expansion_count: Math.max(0, patch.expansion_count || 0),
    last_run_added: Math.max(0, patch.last_run_added || 0),
    last_expanded_at: patch.last_expanded_at || null,
    updated_at: patch.updated_at || null,
  };
}

export function normalizeSearchContext(
  input: unknown,
  fallback: SearchContextPatch = {}
): LeadListSearchContext {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return createSearchContext(fallback);
  }

  const raw = input as Record<string, unknown>;

  return createSearchContext({
    niche:
      typeof raw.niche === "string" ? raw.niche : fallback.niche,
    location:
      typeof raw.location === "string" ? raw.location : fallback.location,
    seed_query:
      typeof raw.seed_query === "string" ? raw.seed_query : fallback.seed_query,
    keyword_history: [
      ...(fallback.keyword_history || []),
      ...toStringArray(raw.keyword_history),
    ],
    query_history: [
      ...(fallback.query_history || []),
      ...toStringArray(raw.query_history),
    ],
    attempted_queries: [
      ...(fallback.attempted_queries || []),
      ...toStringArray(raw.attempted_queries),
    ],
    attempted_keywords: [
      ...(fallback.attempted_keywords || []),
      ...toStringArray(raw.attempted_keywords),
    ],
    successful_queries: [
      ...(fallback.successful_queries || []),
      ...toStringArray(raw.successful_queries),
    ],
    last_generated_queries: [
      ...(fallback.last_generated_queries || []),
      ...toStringArray(raw.last_generated_queries),
    ],
    last_generated_keywords: [
      ...(fallback.last_generated_keywords || []),
      ...toStringArray(raw.last_generated_keywords),
    ],
    target_min_new_leads:
      typeof raw.target_min_new_leads === "number"
        ? raw.target_min_new_leads
        : fallback.target_min_new_leads,
    expansion_count:
      typeof raw.expansion_count === "number"
        ? raw.expansion_count
        : fallback.expansion_count,
    last_run_added:
      typeof raw.last_run_added === "number"
        ? raw.last_run_added
        : fallback.last_run_added,
    last_expanded_at:
      typeof raw.last_expanded_at === "string"
        ? raw.last_expanded_at
        : fallback.last_expanded_at,
    updated_at:
      typeof raw.updated_at === "string"
        ? raw.updated_at
        : fallback.updated_at,
  });
}

export function mergeSearchContext(
  current: unknown,
  patch: SearchContextPatch
): LeadListSearchContext {
  const base = normalizeSearchContext(current);
  return createSearchContext({
    niche: patch.niche ?? base.niche,
    location: patch.location ?? base.location,
    seed_query: patch.seed_query ?? base.seed_query ?? deriveSeedQuery(patch, base),
    keyword_history: [
      ...base.keyword_history,
      ...(patch.keyword_history || []),
      ...(patch.attempted_keywords || []),
    ],
    query_history: [
      ...base.query_history,
      ...(patch.query_history || []),
      ...(patch.attempted_queries || []),
    ],
    attempted_queries: [
      ...base.attempted_queries,
      ...(patch.attempted_queries || []),
    ],
    attempted_keywords: [
      ...base.attempted_keywords,
      ...(patch.attempted_keywords || []),
    ],
    successful_queries: [
      ...base.successful_queries,
      ...(patch.successful_queries || []),
    ],
    last_generated_queries:
      patch.last_generated_queries || base.last_generated_queries,
    last_generated_keywords:
      patch.last_generated_keywords || base.last_generated_keywords,
    target_min_new_leads:
      patch.target_min_new_leads || base.target_min_new_leads,
    expansion_count:
      patch.expansion_count !== undefined
        ? patch.expansion_count
        : base.expansion_count,
    last_run_added:
      patch.last_run_added !== undefined
        ? patch.last_run_added
        : base.last_run_added,
    last_expanded_at: patch.last_expanded_at ?? base.last_expanded_at,
    updated_at: patch.updated_at ?? base.updated_at ?? new Date().toISOString(),
  });
}

export function keywordCountForList(
  context: unknown,
  fallbackKeywords: string[] = []
): number {
  const normalized = normalizeSearchContext(context, {
    attempted_keywords: fallbackKeywords,
  });
  return normalized.attempted_keywords.length;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function deriveSeedQuery(
  patch: SearchContextPatch,
  base: LeadListSearchContext
): string | null {
  if (patch.niche && patch.location) {
    return `${patch.niche} ${patch.location}`.trim();
  }
  if (base.niche && base.location) {
    return `${base.niche} ${base.location}`.trim();
  }
  return null;
}
