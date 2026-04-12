-- CRM v2 clean-break for single shared agency organization
-- This migration keeps legacy CRM tables intact and introduces a new v2 model.

CREATE TABLE public.crm_pipelines_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE public.crm_stages_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines_v2(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6366f1',
  is_closed_won BOOLEAN NOT NULL DEFAULT false,
  is_closed_lost BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (pipeline_id, name)
);

CREATE TABLE public.crm_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website_url TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  niche TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_lead_id UUID,
  UNIQUE (org_id, name)
);

CREATE TABLE public.crm_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  email TEXT,
  linkedin_url TEXT,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  legacy_lead_id UUID
);

CREATE TABLE public.crm_opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines_v2(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.crm_stages_v2(id) ON DELETE RESTRICT,
  account_id UUID REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
  primary_contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  probability INTEGER NOT NULL DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  expected_close_date DATE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost', 'archived')),
  loss_reason TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  tags TEXT[] NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  won_at TIMESTAMPTZ,
  lost_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  legacy_deal_id UUID
);

CREATE TABLE public.crm_opportunity_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines_v2(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES public.crm_stages_v2(id) ON DELETE SET NULL,
  to_stage_id UUID NOT NULL REFERENCES public.crm_stages_v2(id) ON DELETE RESTRICT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_at TIMESTAMPTZ,
  reminder_at TIMESTAMPTZ,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id UUID REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  account_id UUID REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  task_id UUID REFERENCES public.crm_tasks(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('note', 'call', 'meeting', 'email', 'system', 'stage_change')),
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_activity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES public.crm_activities(id) ON DELETE CASCADE,
  linked_type TEXT NOT NULL CHECK (linked_type IN ('calendar_event', 'lead', 'deal', 'telephony_call', 'drive_node')),
  linked_id UUID NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, linked_type, linked_id)
);

CREATE INDEX idx_crm_accounts_org ON public.crm_accounts(org_id);
CREATE INDEX idx_crm_contacts_org_account ON public.crm_contacts(org_id, account_id);
CREATE INDEX idx_crm_opportunities_org_pipeline_stage ON public.crm_opportunities(org_id, pipeline_id, stage_id);
CREATE INDEX idx_crm_opportunities_owner ON public.crm_opportunities(owner_user_id);
CREATE INDEX idx_crm_opportunities_status ON public.crm_opportunities(status);
CREATE INDEX idx_crm_tasks_org_status_due ON public.crm_tasks(org_id, status, due_at);
CREATE INDEX idx_crm_tasks_assigned ON public.crm_tasks(assigned_to);
CREATE INDEX idx_crm_activities_org_happened ON public.crm_activities(org_id, happened_at DESC);
CREATE INDEX idx_crm_activities_opportunity ON public.crm_activities(opportunity_id, happened_at DESC);
CREATE INDEX idx_crm_stage_history_opportunity ON public.crm_opportunity_stage_history(opportunity_id, changed_at DESC);

ALTER TABLE public.crm_pipelines_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_stages_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunity_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activity_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crm_v2_pipelines_org"
  ON public.crm_pipelines_v2 FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "crm_v2_stages_org"
  ON public.crm_stages_v2 FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.crm_pipelines_v2 p
      WHERE p.id = crm_stages_v2.pipeline_id AND public.is_org_member(p.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.crm_pipelines_v2 p
      WHERE p.id = crm_stages_v2.pipeline_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "crm_v2_accounts_org"
  ON public.crm_accounts FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "crm_v2_contacts_org"
  ON public.crm_contacts FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "crm_v2_opportunities_org"
  ON public.crm_opportunities FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "crm_v2_stage_history_org"
  ON public.crm_opportunity_stage_history FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "crm_v2_tasks_org"
  ON public.crm_tasks FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "crm_v2_activities_org"
  ON public.crm_activities FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "crm_v2_activity_links_org"
  ON public.crm_activity_links FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

GRANT ALL ON public.crm_pipelines_v2 TO authenticated, service_role;
GRANT ALL ON public.crm_stages_v2 TO authenticated, service_role;
GRANT ALL ON public.crm_accounts TO authenticated, service_role;
GRANT ALL ON public.crm_contacts TO authenticated, service_role;
GRANT ALL ON public.crm_opportunities TO authenticated, service_role;
GRANT ALL ON public.crm_opportunity_stage_history TO authenticated, service_role;
GRANT ALL ON public.crm_tasks TO authenticated, service_role;
GRANT ALL ON public.crm_activities TO authenticated, service_role;
GRANT ALL ON public.crm_activity_links TO authenticated, service_role;

-- Seed default pipeline + stages for the single shared agency org.
INSERT INTO public.crm_pipelines_v2 (id, org_id, name, is_default)
VALUES (
  '11000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'Agency Pipeline',
  true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.crm_stages_v2 (pipeline_id, name, sort_order, color, is_closed_won, is_closed_lost)
SELECT s.pipeline_id, s.name, s.sort_order, s.color, s.is_closed_won, s.is_closed_lost
FROM (
  VALUES
    ('11000000-0000-4000-8000-000000000001'::uuid, 'New prospect', 0, '#64748b', false, false),
    ('11000000-0000-4000-8000-000000000001', 'Discovery', 1, '#38bdf8', false, false),
    ('11000000-0000-4000-8000-000000000001', 'Qualification', 2, '#a78bfa', false, false),
    ('11000000-0000-4000-8000-000000000001', 'Proposal sent', 3, '#f59e0b', false, false),
    ('11000000-0000-4000-8000-000000000001', 'Negotiation', 4, '#f97316', false, false),
    ('11000000-0000-4000-8000-000000000001', 'Won', 5, '#22c55e', true, false),
    ('11000000-0000-4000-8000-000000000001', 'Lost', 6, '#ef4444', false, true)
) AS s(pipeline_id, name, sort_order, color, is_closed_won, is_closed_lost)
WHERE EXISTS (SELECT 1 FROM public.crm_pipelines_v2 p WHERE p.id = s.pipeline_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.crm_stages_v2 x WHERE x.pipeline_id = s.pipeline_id
  );

CREATE OR REPLACE VIEW public.crm_v2_reporting_funnel AS
SELECT
  o.org_id,
  o.pipeline_id,
  o.stage_id,
  s.name AS stage_name,
  s.sort_order AS stage_order,
  COUNT(*)::bigint AS opportunity_count,
  COALESCE(SUM(o.amount_cents), 0)::bigint AS amount_cents
FROM public.crm_opportunities o
INNER JOIN public.crm_stages_v2 s ON s.id = o.stage_id
WHERE o.status <> 'archived'
GROUP BY o.org_id, o.pipeline_id, o.stage_id, s.name, s.sort_order;

CREATE OR REPLACE VIEW public.crm_v2_reporting_owner_performance AS
SELECT
  o.org_id,
  o.owner_user_id,
  COUNT(*)::bigint AS total_opportunities,
  COUNT(*) FILTER (WHERE o.status = 'won')::bigint AS won_count,
  COUNT(*) FILTER (WHERE o.status = 'lost')::bigint AS lost_count,
  COALESCE(SUM(o.amount_cents) FILTER (WHERE o.status = 'won'), 0)::bigint AS won_amount_cents
FROM public.crm_opportunities o
GROUP BY o.org_id, o.owner_user_id;

CREATE MATERIALIZED VIEW public.crm_v2_reporting_velocity AS
SELECT
  h.org_id,
  h.opportunity_id,
  h.to_stage_id AS stage_id,
  MIN(h.changed_at) AS entered_at,
  LEAD(MIN(h.changed_at)) OVER (
    PARTITION BY h.opportunity_id ORDER BY MIN(h.changed_at)
  ) AS exited_at
FROM public.crm_opportunity_stage_history h
GROUP BY h.org_id, h.opportunity_id, h.to_stage_id;

CREATE INDEX idx_crm_v2_reporting_velocity_org ON public.crm_v2_reporting_velocity(org_id);
CREATE INDEX idx_crm_v2_reporting_velocity_stage ON public.crm_v2_reporting_velocity(stage_id);

GRANT SELECT ON public.crm_v2_reporting_funnel TO authenticated, service_role;
GRANT SELECT ON public.crm_v2_reporting_owner_performance TO authenticated, service_role;
GRANT SELECT ON public.crm_v2_reporting_velocity TO authenticated, service_role;
