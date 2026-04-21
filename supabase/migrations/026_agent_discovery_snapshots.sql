-- Persisted Google Maps discovery batches per agent session (survives ticks; not scratchpad-only).

CREATE TABLE IF NOT EXISTS public.agent_discovery_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.agent_sessions(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  lead_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_discovery_snapshots_session
  ON public.agent_discovery_snapshots(session_id, created_at DESC);

ALTER TABLE public.agent_discovery_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agent_discovery_snapshots_org ON public.agent_discovery_snapshots;
CREATE POLICY agent_discovery_snapshots_org ON public.agent_discovery_snapshots
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.agent_sessions s
    WHERE s.id = session_id AND public.is_org_member(s.org_id)
  ));

GRANT ALL ON public.agent_discovery_snapshots TO authenticated;
GRANT ALL ON public.agent_discovery_snapshots TO service_role;
