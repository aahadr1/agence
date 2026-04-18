-- Agent OS: durable sources, artifacts, decisions, audit log (org-scoped via session)

CREATE TABLE IF NOT EXISTS public.agent_os_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  trust_score NUMERIC,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_os_sources_session ON public.agent_os_sources(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_os_sources_org ON public.agent_os_sources(org_id);

ALTER TABLE public.agent_os_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_os_sources_org ON public.agent_os_sources;
CREATE POLICY agent_os_sources_org ON public.agent_os_sources
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

CREATE TABLE IF NOT EXISTS public.agent_os_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT,
  body TEXT,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_os_artifacts_session ON public.agent_os_artifacts(session_id);

ALTER TABLE public.agent_os_artifacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_os_artifacts_org ON public.agent_os_artifacts;
CREATE POLICY agent_os_artifacts_org ON public.agent_os_artifacts
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

CREATE TABLE IF NOT EXISTS public.agent_os_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,
  rationale TEXT,
  risk_class TEXT NOT NULL DEFAULT 'green' CHECK (risk_class IN ('green', 'yellow', 'red')),
  needs_approval BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_os_decisions_session ON public.agent_os_decisions(session_id);

ALTER TABLE public.agent_os_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_os_decisions_org ON public.agent_os_decisions;
CREATE POLICY agent_os_decisions_org ON public.agent_os_decisions
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

CREATE TABLE IF NOT EXISTS public.agent_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID REFERENCES public.agent_sessions(id) ON DELETE SET NULL,
  tool_name TEXT NOT NULL,
  risk_class TEXT NOT NULL DEFAULT 'green' CHECK (risk_class IN ('green', 'yellow', 'red')),
  ok BOOLEAN NOT NULL,
  error_excerpt TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_log_session ON public.agent_audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_audit_log_org_created ON public.agent_audit_log(org_id, created_at DESC);

ALTER TABLE public.agent_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_audit_log_org ON public.agent_audit_log;
CREATE POLICY agent_audit_log_org ON public.agent_audit_log
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
