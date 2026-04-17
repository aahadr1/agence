-- Agent V3: generic sessions + structured todos, reflections, memory, approvals, user connections
-- Depends on: 010_organization_foundation (organizations, is_org_member)
-- Depends on: 019_lead_agent_v2 (missions - kept for backward compat)

-- ---------------------------------------------------------------------------
-- Agent sessions (generalization of missions)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'planning', 'awaiting_approval', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  model TEXT NOT NULL DEFAULT 'gemini-2.5-pro',
  capability_packs TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  domain_instructions TEXT,
  budget_cap_cents INTEGER,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  -- Link to legacy mission (when session was created via /api/lead-agent/missions)
  mission_id UUID REFERENCES public.missions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_org ON public.agent_sessions(org_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON public.agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_status ON public.agent_sessions(status);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_mission ON public.agent_sessions(mission_id);

ALTER TABLE public.agent_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_sessions_select_org ON public.agent_sessions;
CREATE POLICY agent_sessions_select_org ON public.agent_sessions
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
DROP POLICY IF EXISTS agent_sessions_insert_org ON public.agent_sessions;
CREATE POLICY agent_sessions_insert_org ON public.agent_sessions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);
DROP POLICY IF EXISTS agent_sessions_update_org ON public.agent_sessions;
CREATE POLICY agent_sessions_update_org ON public.agent_sessions
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Agent session messages (chat history + thinking + approvals)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN (
    'user', 'assistant', 'thinking', 'system', 'plan', 'error',
    'approval_request', 'approval_response'
  )),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON public.agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_created ON public.agent_messages(session_id, created_at);

ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_messages_org ON public.agent_messages;
CREATE POLICY agent_messages_org ON public.agent_messages
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

-- ---------------------------------------------------------------------------
-- Agent todos (Claude Code-style task list)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_todos_session ON public.agent_todos(session_id, position);
CREATE INDEX IF NOT EXISTS idx_agent_todos_status ON public.agent_todos(status);

ALTER TABLE public.agent_todos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_todos_org ON public.agent_todos;
CREATE POLICY agent_todos_org ON public.agent_todos
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

-- ---------------------------------------------------------------------------
-- Agent reflections (self-review entries)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  iteration INTEGER NOT NULL DEFAULT 0,
  observation TEXT NOT NULL,
  conclusion TEXT NOT NULL,
  next_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_reflections_session ON public.agent_reflections(session_id, created_at);

ALTER TABLE public.agent_reflections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_reflections_org ON public.agent_reflections;
CREATE POLICY agent_reflections_org ON public.agent_reflections
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

-- ---------------------------------------------------------------------------
-- Agent memory (durable key/value scratchpad — replaces in-memory Map)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_memory (
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, key)
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_session ON public.agent_memory(session_id);

ALTER TABLE public.agent_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_memory_org ON public.agent_memory;
CREATE POLICY agent_memory_org ON public.agent_memory
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

-- ---------------------------------------------------------------------------
-- Agent approvals
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  risk TEXT NOT NULL DEFAULT 'medium' CHECK (risk IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'awaiting'
    CHECK (status IN ('awaiting', 'approved', 'rejected', 'expired')),
  user_response TEXT,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_approvals_session ON public.agent_approvals(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_status ON public.agent_approvals(status);

ALTER TABLE public.agent_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_approvals_org ON public.agent_approvals;
CREATE POLICY agent_approvals_org ON public.agent_approvals
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

-- ---------------------------------------------------------------------------
-- Agent plans (high-level plan snapshots)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  goal TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  revision_reason TEXT,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_plans_session ON public.agent_plans(session_id, version);

ALTER TABLE public.agent_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_plans_org ON public.agent_plans;
CREATE POLICY agent_plans_org ON public.agent_plans
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

-- ---------------------------------------------------------------------------
-- User connections (OAuth tokens for Gmail, Google Calendar, etc.)
-- Tokens are stored encrypted via pgcrypto if AGENT_ENCRYPTION_KEY is set in
-- the app; otherwise as plaintext behind RLS. Prefer to rotate aggressively.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.user_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  -- Encrypted blobs (base64). Decryption happens in the app layer.
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  account_email TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider, account_email)
);

CREATE INDEX IF NOT EXISTS idx_user_connections_user ON public.user_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_user_connections_org ON public.user_connections(org_id);
CREATE INDEX IF NOT EXISTS idx_user_connections_provider ON public.user_connections(provider);

ALTER TABLE public.user_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_connections_select_self ON public.user_connections;
CREATE POLICY user_connections_select_self ON public.user_connections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS user_connections_insert_self ON public.user_connections;
CREATE POLICY user_connections_insert_self ON public.user_connections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS user_connections_update_self ON public.user_connections;
CREATE POLICY user_connections_update_self ON public.user_connections
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS user_connections_delete_self ON public.user_connections;
CREATE POLICY user_connections_delete_self ON public.user_connections
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Grant service_role access (needed because tables are created via SQL Editor)
-- ---------------------------------------------------------------------------

GRANT ALL ON public.agent_sessions, public.agent_messages, public.agent_todos,
  public.agent_reflections, public.agent_memory, public.agent_approvals,
  public.agent_plans, public.user_connections TO service_role;

-- ---------------------------------------------------------------------------
-- Enable Realtime for live UI updates
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_sessions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_messages;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_todos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_reflections;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_approvals;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_plans;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
