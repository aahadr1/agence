ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS search_context JSONB DEFAULT '{}'::jsonb;

UPDATE public.lead_lists
SET search_context = jsonb_build_object(
  'niche', NULL,
  'location', NULL,
  'seed_query', NULL,
  'keyword_history', to_jsonb(COALESCE(keywords, ARRAY[]::text[])),
  'query_history', '[]'::jsonb,
  'attempted_queries', '[]'::jsonb,
  'attempted_keywords', to_jsonb(COALESCE(keywords, ARRAY[]::text[])),
  'successful_queries', '[]'::jsonb,
  'last_generated_queries', '[]'::jsonb,
  'last_generated_keywords', to_jsonb(COALESCE(keywords, ARRAY[]::text[])),
  'target_min_new_leads', 12,
  'expansion_count', 0,
  'last_run_added', 0,
  'last_expanded_at', NULL,
  'updated_at', NULL
)
WHERE search_context IS NULL OR search_context = '{}'::jsonb;
