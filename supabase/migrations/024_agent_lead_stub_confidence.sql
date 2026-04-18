-- Agent lead-gen: tie CRM inserts to lead_searches (search_id NOT NULL) + confidence_score on leads

-- Stub search row for agent / legacy mission runs (service-role inserts bypass RLS)
ALTER TABLE public.lead_searches
  ADD COLUMN IF NOT EXISTS agent_session_id UUID REFERENCES public.agent_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.lead_searches
  ADD COLUMN IF NOT EXISTS stub_session_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_searches_stub_session_key
  ON public.lead_searches (stub_session_key)
  WHERE stub_session_key IS NOT NULL;

COMMENT ON COLUMN public.lead_searches.agent_session_id IS
  'When the client id matches a row in agent_sessions, links the stub to that session (nullable for legacy mission ids).';

COMMENT ON COLUMN public.lead_searches.stub_session_key IS
  'Stable id for idempotent stub lookup (agent session id or legacy mission id used as sessionId in tools).';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS confidence_score INTEGER;

COMMENT ON COLUMN public.leads.confidence_score IS
  'Optional 0–100 data confidence from agent tools (save_lead / batch_save_leads).';
