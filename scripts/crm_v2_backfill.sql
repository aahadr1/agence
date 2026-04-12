-- One-time backfill from legacy CRM (011) to CRM v2 (013).
-- Run after 013_crm_v2_rebuild.sql is applied.

BEGIN;

-- 1) Ensure at least one v2 pipeline per org present in legacy deals.
INSERT INTO public.crm_pipelines_v2 (org_id, name, is_default)
SELECT DISTINCT d.org_id, 'Agency Pipeline', true
FROM public.deals d
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_pipelines_v2 p WHERE p.org_id = d.org_id
)
ON CONFLICT DO NOTHING;

-- 2) Ensure baseline stages exist for those pipelines.
INSERT INTO public.crm_stages_v2 (pipeline_id, name, sort_order, color, is_closed_won, is_closed_lost)
SELECT p.id, s.name, s.sort_order, s.color, s.is_closed_won, s.is_closed_lost
FROM public.crm_pipelines_v2 p
CROSS JOIN (
  VALUES
    ('New prospect', 0, '#64748b', false, false),
    ('Discovery', 1, '#38bdf8', false, false),
    ('Qualification', 2, '#a78bfa', false, false),
    ('Proposal sent', 3, '#f59e0b', false, false),
    ('Negotiation', 4, '#f97316', false, false),
    ('Won', 5, '#22c55e', true, false),
    ('Lost', 6, '#ef4444', false, true)
) AS s(name, sort_order, color, is_closed_won, is_closed_lost)
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_stages_v2 x WHERE x.pipeline_id = p.id
);

-- 3) Accounts from legacy deals.
INSERT INTO public.crm_accounts (
  org_id,
  name,
  website_url,
  phone,
  email,
  niche,
  source,
  owner_user_id,
  created_by,
  created_at,
  updated_at,
  legacy_lead_id
)
SELECT DISTINCT
  d.org_id,
  d.title,
  NULL,
  d.contact_phone,
  d.contact_email,
  d.niche,
  'legacy_migration',
  d.owner_user_id,
  d.owner_user_id,
  d.created_at,
  d.updated_at,
  d.lead_id
FROM public.deals d
WHERE NOT EXISTS (
  SELECT 1
  FROM public.crm_accounts a
  WHERE a.org_id = d.org_id
    AND a.name = d.title
    AND COALESCE(a.phone, '') = COALESCE(d.contact_phone, '')
    AND COALESCE(a.email, '') = COALESCE(d.contact_email, '')
);

-- 4) Contacts from legacy deals.
INSERT INTO public.crm_contacts (
  org_id,
  account_id,
  full_name,
  role,
  phone,
  email,
  owner_user_id,
  created_by,
  created_at,
  updated_at,
  legacy_lead_id
)
SELECT
  d.org_id,
  a.id,
  COALESCE(d.contact_name, d.title),
  NULL,
  d.contact_phone,
  d.contact_email,
  d.owner_user_id,
  d.owner_user_id,
  d.created_at,
  d.updated_at,
  d.lead_id
FROM public.deals d
LEFT JOIN public.crm_accounts a
  ON a.org_id = d.org_id
  AND a.name = d.title
  AND COALESCE(a.phone, '') = COALESCE(d.contact_phone, '')
  AND COALESCE(a.email, '') = COALESCE(d.contact_email, '')
WHERE NOT EXISTS (
  SELECT 1
  FROM public.crm_contacts c
  WHERE c.org_id = d.org_id
    AND c.full_name = COALESCE(d.contact_name, d.title)
    AND COALESCE(c.phone, '') = COALESCE(d.contact_phone, '')
    AND COALESCE(c.email, '') = COALESCE(d.contact_email, '')
);

-- 5) Opportunities from legacy deals.
-- Stage mapping is by normalized name where possible, otherwise falls back to first stage.
WITH stage_map AS (
  SELECT
    d.id AS legacy_deal_id,
    d.org_id,
    p.id AS pipeline_id,
    COALESCE(
      (
        SELECT s2.id
        FROM public.crm_stages_v2 s2
        LEFT JOIN public.crm_stages s1 ON s1.id = d.stage_id
        WHERE s2.pipeline_id = p.id
          AND LOWER(s2.name) = LOWER(COALESCE(s1.name, ''))
        ORDER BY s2.sort_order ASC
        LIMIT 1
      ),
      (
        SELECT s3.id
        FROM public.crm_stages_v2 s3
        WHERE s3.pipeline_id = p.id
        ORDER BY s3.sort_order ASC
        LIMIT 1
      )
    ) AS stage_id
  FROM public.deals d
  INNER JOIN public.crm_pipelines_v2 p ON p.org_id = d.org_id
  WHERE p.is_default = true
)
INSERT INTO public.crm_opportunities (
  org_id,
  pipeline_id,
  stage_id,
  account_id,
  primary_contact_id,
  title,
  description,
  owner_user_id,
  amount_cents,
  currency,
  probability,
  expected_close_date,
  status,
  loss_reason,
  source,
  tags,
  sort_order,
  created_by,
  created_at,
  updated_at,
  legacy_deal_id
)
SELECT
  d.org_id,
  sm.pipeline_id,
  sm.stage_id,
  a.id,
  c.id,
  d.title,
  NULL,
  d.owner_user_id,
  COALESCE(d.value_cents, 0),
  COALESCE(d.currency, 'EUR'),
  0,
  NULL,
  CASE
    WHEN LOWER(st.name) LIKE '%lost%' THEN 'lost'
    WHEN LOWER(st.name) LIKE '%sign%' OR LOWER(st.name) LIKE '%won%' THEN 'won'
    ELSE 'open'
  END,
  d.lost_reason,
  'legacy_migration',
  COALESCE(d.tags, '{}'),
  COALESCE(d.sort_order, 0),
  d.owner_user_id,
  d.created_at,
  d.updated_at,
  d.id
FROM public.deals d
INNER JOIN stage_map sm ON sm.legacy_deal_id = d.id
LEFT JOIN public.crm_accounts a
  ON a.org_id = d.org_id
  AND a.name = d.title
  AND COALESCE(a.phone, '') = COALESCE(d.contact_phone, '')
  AND COALESCE(a.email, '') = COALESCE(d.contact_email, '')
LEFT JOIN public.crm_contacts c
  ON c.org_id = d.org_id
  AND c.full_name = COALESCE(d.contact_name, d.title)
  AND COALESCE(c.phone, '') = COALESCE(d.contact_phone, '')
  AND COALESCE(c.email, '') = COALESCE(d.contact_email, '')
LEFT JOIN public.crm_stages st ON st.id = d.stage_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.crm_opportunities o WHERE o.legacy_deal_id = d.id
);

-- 6) Stage history seed from current position.
INSERT INTO public.crm_opportunity_stage_history (
  org_id,
  opportunity_id,
  pipeline_id,
  from_stage_id,
  to_stage_id,
  changed_by,
  changed_at
)
SELECT
  o.org_id,
  o.id,
  o.pipeline_id,
  NULL,
  o.stage_id,
  o.owner_user_id,
  o.created_at
FROM public.crm_opportunities o
WHERE NOT EXISTS (
  SELECT 1
  FROM public.crm_opportunity_stage_history h
  WHERE h.opportunity_id = o.id
);

-- 7) Activities from legacy deal_activities.
INSERT INTO public.crm_activities (
  org_id,
  opportunity_id,
  account_id,
  contact_id,
  type,
  body,
  metadata,
  happened_at,
  created_by,
  created_at
)
SELECT
  a.org_id,
  o.id AS opportunity_id,
  o.account_id,
  o.primary_contact_id,
  CASE
    WHEN a.type IN ('note', 'call', 'meeting', 'system', 'stage_change') THEN a.type
    WHEN a.type = 'file' THEN 'system'
    ELSE 'email'
  END AS type,
  CASE
    WHEN a.type = 'note' THEN COALESCE(a.payload->>'body', 'Imported legacy note')
    WHEN a.type = 'stage_change' THEN 'Stage updated in legacy CRM'
    ELSE COALESCE(a.payload->>'message', 'Imported from legacy CRM')
  END AS body,
  COALESCE(a.payload, '{}'::jsonb) || jsonb_build_object('legacy_activity_id', a.id),
  a.created_at,
  a.created_by,
  a.created_at
FROM public.deal_activities a
INNER JOIN public.crm_opportunities o ON o.legacy_deal_id = a.deal_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.crm_activities x
  WHERE x.metadata->>'legacy_activity_id' = a.id::text
);

-- 8) Refresh velocity MV.
REFRESH MATERIALIZED VIEW public.crm_v2_reporting_velocity;

COMMIT;
