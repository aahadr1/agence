-- Migration 030 — Drop the entire legacy lead-agent / lead-generator schema.
--
-- After this migration, all agent runtime lives on the VPS via OpenCode.
-- The Next.js app only stores a thin `agent_chats` mapping table (see migration 031).
--
-- Tables we explicitly KEEP (still used by other features):
--   - leads, lead_searches, lead_lists, lead_list_items, lead_keywords,
--     lead_outreach_logs, lead_pipeline_history, lead_feedback (CRM v2 reads these)
--   - business_analyses (kept for historical CRM display, even though the live
--     analyzer route is gone — the data is read-only fallback)
--   - users, organizations, organization_members, integrations, calendar*, drive*,
--     telephony*, projects, variants, website_builds
--
-- Tables we DROP (legacy agent v2/v3 internals, lead-agent state, browser workers):

BEGIN;

-- ── Drop FK columns first ────────────────────────────────────────────────────
ALTER TABLE IF EXISTS public.leads
  DROP COLUMN IF EXISTS mission_id,
  DROP COLUMN IF EXISTS mission_step_id;

ALTER TABLE IF EXISTS public.lead_searches
  DROP COLUMN IF EXISTS agent_session_id;

-- ── Drop functions / RPCs ────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.agent_try_lock_session(uuid, text, integer);
DROP FUNCTION IF EXISTS public.agent_release_session(uuid, text);
DROP FUNCTION IF EXISTS public.agent_claim_local_browser_job(uuid, text);

-- ── Drop tables (CASCADE to clean indexes/policies/constraints) ─────────────
DROP TABLE IF EXISTS public.agent_local_browser_jobs CASCADE;
DROP TABLE IF EXISTS public.agent_local_workers CASCADE;
DROP TABLE IF EXISTS public.agent_discovery_snapshots CASCADE;
DROP TABLE IF EXISTS public.agent_audit_log CASCADE;
DROP TABLE IF EXISTS public.agent_os_decisions CASCADE;
DROP TABLE IF EXISTS public.agent_os_artifacts CASCADE;
DROP TABLE IF EXISTS public.agent_os_sources CASCADE;
DROP TABLE IF EXISTS public.org_browser_credentials CASCADE;
DROP TABLE IF EXISTS public.agent_code_commits CASCADE;
DROP TABLE IF EXISTS public.agent_custom_tools CASCADE;
DROP TABLE IF EXISTS public.agent_learnings CASCADE;
DROP TABLE IF EXISTS public.agent_session_steps CASCADE;
DROP TABLE IF EXISTS public.agent_plans CASCADE;
DROP TABLE IF EXISTS public.agent_approvals CASCADE;
DROP TABLE IF EXISTS public.agent_memory CASCADE;
DROP TABLE IF EXISTS public.agent_reflections CASCADE;
DROP TABLE IF EXISTS public.agent_todos CASCADE;
DROP TABLE IF EXISTS public.agent_messages CASCADE;
DROP TABLE IF EXISTS public.agent_sessions CASCADE;

-- Mission tables (lead-agent v2 — pre-OpenCode)
DROP TABLE IF EXISTS public.subagent_runs CASCADE;
DROP TABLE IF EXISTS public.mission_messages CASCADE;
DROP TABLE IF EXISTS public.mission_steps CASCADE;
DROP TABLE IF EXISTS public.missions CASCADE;

-- API call/source tracking (lead-agent enrichment)
DROP TABLE IF EXISTS public.api_calls CASCADE;
DROP TABLE IF EXISTS public.lead_sources CASCADE;

COMMIT;
