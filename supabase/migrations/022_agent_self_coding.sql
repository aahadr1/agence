-- Migration 022 — agent self-coding audit log.
-- Tracks every PR the agent authored so we can rate-limit, audit, and
-- link sessions ↔ PRs in the UI.
--
-- Depends on: 010_organization_foundation (organizations, is_org_member)

CREATE TABLE IF NOT EXISTS public.agent_code_commits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  branch_name TEXT NOT NULL,
  commit_sha TEXT,
  pr_number INTEGER,
  pr_url TEXT,
  pr_title TEXT,
  pr_body TEXT,
  files_changed JSONB NOT NULL DEFAULT '[]'::jsonb,
  commit_message TEXT,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'opened', 'merged', 'closed', 'failed')),
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_code_commits_org
  ON public.agent_code_commits(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_code_commits_session
  ON public.agent_code_commits(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_code_commits_status
  ON public.agent_code_commits(status);

ALTER TABLE public.agent_code_commits ENABLE ROW LEVEL SECURITY;

-- Members of the org can read their org's commit history
DROP POLICY IF EXISTS "agent_code_commits_select_members" ON public.agent_code_commits;
CREATE POLICY "agent_code_commits_select_members"
  ON public.agent_code_commits FOR SELECT
  TO authenticated
  USING (public.is_org_member(org_id));

-- Only service_role writes
DROP POLICY IF EXISTS "agent_code_commits_service_all" ON public.agent_code_commits;
CREATE POLICY "agent_code_commits_service_all"
  ON public.agent_code_commits FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT SELECT ON public.agent_code_commits TO authenticated;
GRANT ALL ON public.agent_code_commits TO service_role;

-- Add to realtime so the UI can live-update proposed PRs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_code_commits;
    EXCEPTION WHEN duplicate_object THEN
      -- already added, ignore
      NULL;
    END;
  END IF;
END $$;
