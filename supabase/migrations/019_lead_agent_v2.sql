-- Lead Agent v2: missions, messages, sub-agent runs, audit trail, feedback
-- Depends on: 010_organization_foundation (organizations, is_org_member)
-- Depends on: 004/005 (leads table)

-- ---------------------------------------------------------------------------
-- Missions
-- ---------------------------------------------------------------------------

CREATE TABLE public.missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'A' CHECK (mode IN ('A', 'B', 'C')),
  user_prompt TEXT NOT NULL,
  plan JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'planning', 'awaiting_approval', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  budget_cap_cents INTEGER,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  leads_target INTEGER,
  leads_found INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_missions_org ON public.missions(org_id);
CREATE INDEX idx_missions_user ON public.missions(user_id);
CREATE INDEX idx_missions_status ON public.missions(status);

ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;

CREATE POLICY missions_select_org ON public.missions
  FOR SELECT TO authenticated USING (public.is_org_member(org_id));
CREATE POLICY missions_insert_org ON public.missions
  FOR INSERT TO authenticated WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY missions_update_org ON public.missions
  FOR UPDATE TO authenticated USING (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Mission steps (plan breakdown)
-- ---------------------------------------------------------------------------

CREATE TABLE public.mission_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_mission_steps_mission ON public.mission_steps(mission_id);

ALTER TABLE public.mission_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY mission_steps_org ON public.mission_steps
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.missions m WHERE m.id = mission_id AND public.is_org_member(m.org_id)));

-- ---------------------------------------------------------------------------
-- Mission messages (chat between user and orchestrator)
-- ---------------------------------------------------------------------------

CREATE TABLE public.mission_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'thinking', 'system', 'plan', 'error')),
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mission_messages_mission ON public.mission_messages(mission_id);
CREATE INDEX idx_mission_messages_created ON public.mission_messages(mission_id, created_at);

ALTER TABLE public.mission_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY mission_messages_org ON public.mission_messages
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.missions m WHERE m.id = mission_id AND public.is_org_member(m.org_id)));

-- ---------------------------------------------------------------------------
-- Sub-agent runs
-- ---------------------------------------------------------------------------

CREATE TABLE public.subagent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID NOT NULL REFERENCES public.missions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN (
    'strategist', 'discovery', 'qualifier', 'owner_finder',
    'contact_finder', 'verifier', 'deduplicator', 'reporter'
  )),
  model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  task JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_subagent_runs_mission ON public.subagent_runs(mission_id);
CREATE INDEX idx_subagent_runs_status ON public.subagent_runs(status);

ALTER TABLE public.subagent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY subagent_runs_org ON public.subagent_runs
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.missions m WHERE m.id = mission_id AND public.is_org_member(m.org_id)));

-- ---------------------------------------------------------------------------
-- Lead sources (RGPD audit trail)
-- ---------------------------------------------------------------------------

CREATE TABLE public.lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  raw_value TEXT,
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_sources_lead ON public.lead_sources(lead_id);
CREATE INDEX idx_lead_sources_field ON public.lead_sources(lead_id, field_name);

ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_sources_org ON public.lead_sources
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND public.is_org_member(l.org_id)));

-- ---------------------------------------------------------------------------
-- API calls (cost tracking)
-- ---------------------------------------------------------------------------

CREATE TABLE public.api_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id UUID REFERENCES public.missions(id) ON DELETE SET NULL,
  subagent_run_id UUID REFERENCES public.subagent_runs(id) ON DELETE SET NULL,
  service TEXT NOT NULL,
  endpoint TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  response_status INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_calls_mission ON public.api_calls(mission_id);
CREATE INDEX idx_api_calls_service ON public.api_calls(service);
CREATE INDEX idx_api_calls_created ON public.api_calls(created_at);

ALTER TABLE public.api_calls ENABLE ROW LEVEL SECURITY;

CREATE POLICY api_calls_org ON public.api_calls
  FOR ALL TO authenticated
  USING (
    mission_id IS NULL
    OR EXISTS (SELECT 1 FROM public.missions m WHERE m.id = mission_id AND public.is_org_member(m.org_id))
  );

-- ---------------------------------------------------------------------------
-- Lead feedback (good/bad rating for feedback loop)
-- ---------------------------------------------------------------------------

CREATE TABLE public.lead_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('good', 'bad')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_feedback_lead ON public.lead_feedback(lead_id);

ALTER TABLE public.lead_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_feedback_org ON public.lead_feedback
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND public.is_org_member(l.org_id)));

-- ---------------------------------------------------------------------------
-- Add mission_id FK to leads table
-- ---------------------------------------------------------------------------

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS mission_id UUID REFERENCES public.missions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_mission ON public.leads(mission_id);

-- ---------------------------------------------------------------------------
-- Enable Realtime for live UI updates
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE public.missions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.mission_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.subagent_runs;
