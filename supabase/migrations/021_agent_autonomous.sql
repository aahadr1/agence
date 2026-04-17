-- Agent V3 Autonomous runtime: self-ticking loop, lock-based concurrency,
-- learnings-based self-improvement, runtime-defined custom tools.
-- Depends on: 020_agent_v3

-- ---------------------------------------------------------------------------
-- Session-level runtime fields (lock + ticker)
-- ---------------------------------------------------------------------------

ALTER TABLE public.agent_sessions
  ADD COLUMN IF NOT EXISTS last_tick_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tick_count     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lock_token     TEXT,
  ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error     TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_lock
  ON public.agent_sessions (lock_expires_at)
  WHERE lock_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_sessions_tick
  ON public.agent_sessions (status, last_tick_at);

-- ---------------------------------------------------------------------------
-- Tick journal: one row per agent step. Gives us durability + replay.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_session_steps (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  step_num      INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','done','failed','retrying')),
  attempt       INTEGER NOT NULL DEFAULT 1,
  input         JSONB NOT NULL DEFAULT '{}'::jsonb,
  output        JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT,
  duration_ms   INTEGER,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (session_id, step_num, attempt)
);

CREATE INDEX IF NOT EXISTS idx_agent_session_steps_session
  ON public.agent_session_steps (session_id, step_num);

ALTER TABLE public.agent_session_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_session_steps_org ON public.agent_session_steps;
CREATE POLICY agent_session_steps_org ON public.agent_session_steps
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

-- ---------------------------------------------------------------------------
-- Learnings: durable self-improvement memory across sessions.
-- Agent writes a learning after reflection; future sessions pull the top-K
-- most relevant ones into the system prompt.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_learnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id    UUID REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  -- short free-form tag like "email", "lead-gen", "browser", "general"
  scope         TEXT NOT NULL DEFAULT 'general',
  -- short title for the learning
  title         TEXT NOT NULL,
  -- the actual lesson, ideally one paragraph, actionable
  content       TEXT NOT NULL,
  -- optional trigger conditions that help the agent know when to apply it
  triggers      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- 0..1 confidence (agent estimate) and upvotes/downvotes from outcomes
  confidence    REAL NOT NULL DEFAULT 0.5,
  upvotes       INTEGER NOT NULL DEFAULT 0,
  downvotes     INTEGER NOT NULL DEFAULT 0,
  archived      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_learnings_org_scope
  ON public.agent_learnings (org_id, scope, archived, confidence DESC);

ALTER TABLE public.agent_learnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_learnings_select_org ON public.agent_learnings;
CREATE POLICY agent_learnings_select_org ON public.agent_learnings
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS agent_learnings_mutate_org ON public.agent_learnings;
CREATE POLICY agent_learnings_mutate_org ON public.agent_learnings
  FOR ALL TO authenticated USING (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Custom tools: the agent can extend itself at runtime by defining new tools.
-- Tool code is executed server-side inside a Node `vm` sandbox with a limited
-- set of bindings (fetch, setTimeout, console). NO filesystem / network admin.
-- Requires explicit human approval (is_approved) before invocation.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.agent_custom_tools (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id     UUID REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  -- JSON-schema-like parameters
  parameters     JSONB NOT NULL DEFAULT '{}'::jsonb,
  required       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- JS source of an async function: async (args, ctx) => { ... return result }
  code           TEXT NOT NULL,
  -- Tool cannot be called until approved (safety gate)
  is_approved    BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  is_disabled    BOOLEAN NOT NULL DEFAULT FALSE,
  -- short free-form tag
  scope          TEXT NOT NULL DEFAULT 'general',
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_agent_custom_tools_org
  ON public.agent_custom_tools (org_id, is_approved, is_disabled);

ALTER TABLE public.agent_custom_tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_custom_tools_select_org ON public.agent_custom_tools;
CREATE POLICY agent_custom_tools_select_org ON public.agent_custom_tools
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS agent_custom_tools_mutate_org ON public.agent_custom_tools;
CREATE POLICY agent_custom_tools_mutate_org ON public.agent_custom_tools
  FOR ALL TO authenticated USING (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Grant service_role
-- ---------------------------------------------------------------------------

GRANT ALL ON
  public.agent_session_steps,
  public.agent_learnings,
  public.agent_custom_tools
TO service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_session_steps;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_learnings;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_custom_tools;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Helper function: tryLockSession(sessionId, token, ttl_seconds)
-- Returns TRUE if the session lock was acquired (or refreshed by the same
-- token). Returns FALSE if another live lock is held.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agent_try_lock_session(
  p_session_id UUID,
  p_token      TEXT,
  p_ttl_sec    INTEGER DEFAULT 120
) RETURNS BOOLEAN AS $$
DECLARE
  v_now       TIMESTAMPTZ := now();
  v_row       public.agent_sessions%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.agent_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  -- Same token refreshes the lease
  IF v_row.lock_token = p_token THEN
    UPDATE public.agent_sessions
      SET lock_expires_at = v_now + make_interval(secs => p_ttl_sec)
      WHERE id = p_session_id;
    RETURN TRUE;
  END IF;

  -- Free slot (no active lease)
  IF v_row.lock_token IS NULL OR v_row.lock_expires_at IS NULL OR v_row.lock_expires_at < v_now THEN
    UPDATE public.agent_sessions
      SET lock_token = p_token,
          lock_expires_at = v_now + make_interval(secs => p_ttl_sec)
      WHERE id = p_session_id;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.agent_try_lock_session TO service_role;

-- ---------------------------------------------------------------------------
-- Helper function: release lock if we own it
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agent_release_session(
  p_session_id UUID,
  p_token      TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.agent_sessions
    SET lock_token = NULL, lock_expires_at = NULL
    WHERE id = p_session_id AND lock_token = p_token;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.agent_release_session TO service_role;
