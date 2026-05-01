-- Local browser workers: per-user machine executors for Playwright-heavy tools.
-- The web app keeps LLM/API/CRM keys server-side; local workers only receive
-- browser jobs assigned to their owner.

CREATE TABLE IF NOT EXISTS public.agent_local_workers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Local worker',
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'online', 'offline', 'revoked')),
  last_seen_at TIMESTAMPTZ,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_local_workers_owner
  ON public.agent_local_workers (org_id, user_id, status, last_seen_at DESC);

ALTER TABLE public.agent_local_workers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_local_workers_owner_select ON public.agent_local_workers;
CREATE POLICY agent_local_workers_owner_select ON public.agent_local_workers
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND public.is_org_member(org_id));

DROP POLICY IF EXISTS agent_local_workers_owner_update ON public.agent_local_workers;
CREATE POLICY agent_local_workers_owner_update ON public.agent_local_workers
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND public.is_org_member(org_id));

CREATE TABLE IF NOT EXISTS public.agent_local_browser_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  worker_id UUID REFERENCES public.agent_local_workers(id) ON DELETE SET NULL,
  session_id UUID REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'completed', 'failed', 'expired')),
  result JSONB,
  error TEXT,
  claimed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_local_browser_jobs_pickup
  ON public.agent_local_browser_jobs (worker_id, status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_agent_local_browser_jobs_session
  ON public.agent_local_browser_jobs (session_id, created_at);

ALTER TABLE public.agent_local_browser_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_local_browser_jobs_owner_select ON public.agent_local_browser_jobs;
CREATE POLICY agent_local_browser_jobs_owner_select ON public.agent_local_browser_jobs
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND public.is_org_member(org_id));

GRANT ALL ON public.agent_local_workers, public.agent_local_browser_jobs TO service_role;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_local_workers;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_local_browser_jobs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
