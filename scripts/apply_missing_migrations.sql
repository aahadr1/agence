-- ==========================================================================
-- APPLY ALL MISSING MIGRATIONS (010 → 017) TO LIVE SUPABASE
-- Run this entire script in the Supabase SQL Editor in one go.
-- ==========================================================================

-- ===================== 010: Organization Foundation =====================

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_members_user_id ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_id ON public.organization_members(org_id);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  title TEXT,
  default_status_text TEXT,
  working_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER to avoid RLS recursion (org_members policy calls is_org_member)
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = p_org_id AND m.user_id = auth.uid()
  );
$$;

DROP POLICY IF EXISTS "org_select_member" ON public.organizations;
CREATE POLICY "org_select_member"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));

DROP POLICY IF EXISTS "org_insert_authenticated" ON public.organizations;
CREATE POLICY "org_insert_authenticated"
  ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "org_update_admin" ON public.organizations;
CREATE POLICY "org_update_admin"
  ON public.organizations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.org_id = organizations.id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "org_members_select" ON public.organization_members;
CREATE POLICY "org_members_select"
  ON public.organization_members FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "org_members_insert_self_or_admin" ON public.organization_members;
CREATE POLICY "org_members_insert_self_or_admin"
  ON public.organization_members FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.org_id = organization_members.org_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "org_members_update_admin" ON public.organization_members;
CREATE POLICY "org_members_update_admin"
  ON public.organization_members FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.org_id = organization_members.org_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner', 'admin')
    )
  );

DROP POLICY IF EXISTS "org_members_delete_admin_or_self" ON public.organization_members;
CREATE POLICY "org_members_delete_admin_or_self"
  ON public.organization_members FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.org_id = organization_members.org_id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  );

DROP POLICY IF EXISTS "profiles_select_org_mates" ON public.profiles;
CREATE POLICY "profiles_select_org_mates"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members m1
      INNER JOIN public.organization_members m2 ON m1.org_id = m2.org_id
      WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.user_id
    )
  );

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT ALL ON public.organizations TO anon, authenticated, service_role;
GRANT ALL ON public.organization_members TO anon, authenticated, service_role;
GRANT ALL ON public.profiles TO anon, authenticated, service_role;

-- Default org
INSERT INTO public.organizations (id, name, slug)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Agency',
  'agency'
)
ON CONFLICT (id) DO NOTHING;

-- Add org_id to existing tables
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.lead_searches
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.business_analyses
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.telephony_agents
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);
ALTER TABLE public.telephony_calls
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id);

-- Backfill existing rows
UPDATE public.projects SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.lead_searches SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.leads SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.lead_lists SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.business_analyses SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.telephony_agents SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.telephony_calls SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;

-- Make NOT NULL (safe now since all rows are backfilled)
DO $$
BEGIN
  ALTER TABLE public.projects ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.lead_searches ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.leads ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.lead_lists ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.business_analyses ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.telephony_agents ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.telephony_calls ALTER COLUMN org_id SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON public.projects(org_id);
CREATE INDEX IF NOT EXISTS idx_lead_searches_org_id ON public.lead_searches(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_id ON public.leads(org_id);
CREATE INDEX IF NOT EXISTS idx_lead_lists_org_id ON public.lead_lists(org_id);
CREATE INDEX IF NOT EXISTS idx_business_analyses_org_id ON public.business_analyses(org_id);
CREATE INDEX IF NOT EXISTS idx_telephony_agents_org_id ON public.telephony_agents(org_id);
CREATE INDEX IF NOT EXISTS idx_telephony_calls_org_id ON public.telephony_calls(org_id);

-- Seed members + profiles from existing users
INSERT INTO public.profiles (user_id, display_name)
SELECT u.id, split_part(COALESCE(u.email, ''), '@', 1)
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id);

INSERT INTO public.organization_members (org_id, user_id, role)
SELECT DISTINCT
  '00000000-0000-4000-8000-000000000001'::uuid,
  x.user_id,
  'member'::text
FROM (
  SELECT user_id FROM public.projects
  UNION SELECT user_id FROM public.lead_searches
  UNION SELECT user_id FROM public.leads
  UNION SELECT user_id FROM public.lead_lists
  UNION SELECT user_id FROM public.business_analyses
  UNION SELECT user_id FROM public.telephony_agents
) x
WHERE x.user_id IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;

-- Also seed from auth.users directly (catch users with no data yet)
INSERT INTO public.organization_members (org_id, user_id, role)
SELECT '00000000-0000-4000-8000-000000000001'::uuid, u.id, 'member'
FROM auth.users u
WHERE NOT EXISTS (
  SELECT 1 FROM public.organization_members om
  WHERE om.user_id = u.id AND om.org_id = '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (org_id, user_id) DO NOTHING;

-- Promote first member to owner
WITH first_owner AS (
  SELECT user_id FROM public.organization_members
  WHERE org_id = '00000000-0000-4000-8000-000000000001'
  ORDER BY joined_at ASC
  LIMIT 1
)
UPDATE public.organization_members om
SET role = 'owner'
FROM first_owner
WHERE om.org_id = '00000000-0000-4000-8000-000000000001'
  AND om.user_id = first_owner.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.organization_members o2
    WHERE o2.org_id = om.org_id AND o2.role = 'owner'
  );

-- Trigger: auto-provision new users
CREATE OR REPLACE FUNCTION public.handle_new_user_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_org uuid := '00000000-0000-4000-8000-000000000001';
  has_owner boolean;
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (new.id, split_part(COALESCE(new.email, new.id::text), '@', 1))
  ON CONFLICT (user_id) DO NOTHING;

  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE org_id = default_org AND role = 'owner'
  ) INTO has_owner;

  INSERT INTO public.organization_members (org_id, user_id, role)
  VALUES (
    default_org,
    new.id,
    CASE WHEN has_owner THEN 'member' ELSE 'owner' END
  )
  ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_org ON auth.users;
CREATE TRIGGER on_auth_user_created_org
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_org();

-- Rewrite RLS on projects (drop both old and new names for idempotency)
DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can create own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;
DROP POLICY IF EXISTS "projects_select_org" ON public.projects;
DROP POLICY IF EXISTS "projects_insert_org" ON public.projects;
DROP POLICY IF EXISTS "projects_update_org" ON public.projects;
DROP POLICY IF EXISTS "projects_delete_org" ON public.projects;

CREATE POLICY "projects_select_org" ON public.projects FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "projects_insert_org" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "projects_update_org" ON public.projects FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "projects_delete_org" ON public.projects FOR DELETE TO authenticated
  USING (public.is_org_member(org_id));

-- Rewrite RLS on variants
DROP POLICY IF EXISTS "Users can view own variants" ON public.variants;
DROP POLICY IF EXISTS "Users can create own variants" ON public.variants;
DROP POLICY IF EXISTS "Users can update own variants" ON public.variants;
DROP POLICY IF EXISTS "variants_select_org" ON public.variants;
DROP POLICY IF EXISTS "variants_insert_org" ON public.variants;
DROP POLICY IF EXISTS "variants_update_org" ON public.variants;
DROP POLICY IF EXISTS "variants_delete_org" ON public.variants;

CREATE POLICY "variants_select_org" ON public.variants FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = variants.project_id AND public.is_org_member(p.org_id)));
CREATE POLICY "variants_insert_org" ON public.variants FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = variants.project_id AND public.is_org_member(p.org_id)));
CREATE POLICY "variants_update_org" ON public.variants FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = variants.project_id AND public.is_org_member(p.org_id)));

-- Rewrite RLS on project_images
DROP POLICY IF EXISTS "Users can view own project images" ON public.project_images;
DROP POLICY IF EXISTS "Users can insert own project images" ON public.project_images;
DROP POLICY IF EXISTS "Users can update own project images" ON public.project_images;
DROP POLICY IF EXISTS "Users can delete own project images" ON public.project_images;
DROP POLICY IF EXISTS "project_images_select_org" ON public.project_images;
DROP POLICY IF EXISTS "project_images_insert_org" ON public.project_images;
DROP POLICY IF EXISTS "project_images_update_org" ON public.project_images;
DROP POLICY IF EXISTS "project_images_delete_org" ON public.project_images;

CREATE POLICY "project_images_select_org" ON public.project_images FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_images.project_id AND public.is_org_member(p.org_id)));
CREATE POLICY "project_images_insert_org" ON public.project_images FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_images.project_id AND public.is_org_member(p.org_id)));
CREATE POLICY "project_images_update_org" ON public.project_images FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_images.project_id AND public.is_org_member(p.org_id)));
CREATE POLICY "project_images_delete_org" ON public.project_images FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_images.project_id AND public.is_org_member(p.org_id)));

-- Rewrite RLS on website_builds
DROP POLICY IF EXISTS "Users can view own website builds" ON public.website_builds;
DROP POLICY IF EXISTS "Users can insert own website builds" ON public.website_builds;
DROP POLICY IF EXISTS "Users can update own website builds" ON public.website_builds;
DROP POLICY IF EXISTS "website_builds_select_org" ON public.website_builds;
DROP POLICY IF EXISTS "website_builds_insert_org" ON public.website_builds;
DROP POLICY IF EXISTS "website_builds_update_org" ON public.website_builds;
DROP POLICY IF EXISTS "website_builds_delete_org" ON public.website_builds;

CREATE POLICY "website_builds_select_org" ON public.website_builds FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = website_builds.project_id AND public.is_org_member(p.org_id)));
CREATE POLICY "website_builds_insert_org" ON public.website_builds FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = website_builds.project_id AND public.is_org_member(p.org_id)));
CREATE POLICY "website_builds_update_org" ON public.website_builds FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = website_builds.project_id AND public.is_org_member(p.org_id)));
CREATE POLICY "website_builds_delete_org" ON public.website_builds FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = website_builds.project_id AND public.is_org_member(p.org_id)));

-- Rewrite RLS on leads
DROP POLICY IF EXISTS "Users can view own searches" ON public.lead_searches;
DROP POLICY IF EXISTS "Users can insert own searches" ON public.lead_searches;
DROP POLICY IF EXISTS "Users can update own searches" ON public.lead_searches;
DROP POLICY IF EXISTS "lead_searches_select_org" ON public.lead_searches;
DROP POLICY IF EXISTS "lead_searches_insert_org" ON public.lead_searches;
DROP POLICY IF EXISTS "lead_searches_update_org" ON public.lead_searches;

CREATE POLICY "lead_searches_select_org" ON public.lead_searches FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "lead_searches_insert_org" ON public.lead_searches FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "lead_searches_update_org" ON public.lead_searches FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Users can view own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can insert own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can delete own leads" ON public.leads;
DROP POLICY IF EXISTS "leads_select_org" ON public.leads;
DROP POLICY IF EXISTS "leads_insert_org" ON public.leads;
DROP POLICY IF EXISTS "leads_update_org" ON public.leads;
DROP POLICY IF EXISTS "leads_delete_org" ON public.leads;

CREATE POLICY "leads_select_org" ON public.leads FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "leads_insert_org" ON public.leads FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "leads_update_org" ON public.leads FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "leads_delete_org" ON public.leads FOR DELETE TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Users can manage own lists" ON public.lead_lists;
DROP POLICY IF EXISTS "Users can manage own list items" ON public.lead_list_items;
DROP POLICY IF EXISTS "lead_lists_all_org" ON public.lead_lists;
DROP POLICY IF EXISTS "lead_list_items_all_org" ON public.lead_list_items;

CREATE POLICY "lead_lists_all_org" ON public.lead_lists FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "lead_list_items_all_org" ON public.lead_list_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.lead_lists l WHERE l.id = lead_list_items.list_id AND public.is_org_member(l.org_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.lead_lists l WHERE l.id = lead_list_items.list_id AND public.is_org_member(l.org_id)));

-- Rewrite RLS on business_analyses
DROP POLICY IF EXISTS "Users can read own analyses" ON public.business_analyses;
DROP POLICY IF EXISTS "Users can insert own analyses" ON public.business_analyses;
DROP POLICY IF EXISTS "Users can update own analyses" ON public.business_analyses;
DROP POLICY IF EXISTS "business_analyses_select_org" ON public.business_analyses;
DROP POLICY IF EXISTS "business_analyses_insert_org" ON public.business_analyses;
DROP POLICY IF EXISTS "business_analyses_update_org" ON public.business_analyses;
DROP POLICY IF EXISTS "business_analyses_delete_org" ON public.business_analyses;

CREATE POLICY "business_analyses_select_org" ON public.business_analyses FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "business_analyses_insert_org" ON public.business_analyses FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "business_analyses_update_org" ON public.business_analyses FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
CREATE POLICY "business_analyses_delete_org" ON public.business_analyses FOR DELETE TO authenticated
  USING (public.is_org_member(org_id));

-- Rewrite RLS on telephony
DROP POLICY IF EXISTS "telephony_agents_select_own" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_agents_insert_own" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_agents_update_own" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_agents_delete_own" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_calls_select_authenticated" ON public.telephony_calls;
DROP POLICY IF EXISTS "telephony_agents_select_org" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_agents_insert_org" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_agents_update_org" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_agents_delete_org" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_calls_select_org" ON public.telephony_calls;

CREATE POLICY "telephony_agents_select_org" ON public.telephony_agents FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "telephony_agents_insert_org" ON public.telephony_agents FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "telephony_agents_update_org" ON public.telephony_agents FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id) AND auth.uid() = user_id) WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "telephony_agents_delete_org" ON public.telephony_agents FOR DELETE TO authenticated
  USING (public.is_org_member(org_id) AND auth.uid() = user_id);
CREATE POLICY "telephony_calls_select_org" ON public.telephony_calls FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));


-- ===================== 011: Lead list search context =====================

ALTER TABLE public.lead_lists
  ADD COLUMN IF NOT EXISTS search_context JSONB DEFAULT '{}'::jsonb;


-- ===================== 013: CRM v2 Rebuild =====================

CREATE TABLE IF NOT EXISTS public.crm_pipelines_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS public.crm_stages_v2 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines_v2(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6366f1',
  is_closed_won BOOLEAN NOT NULL DEFAULT false,
  is_closed_lost BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (pipeline_id, name)
);

CREATE TABLE IF NOT EXISTS public.crm_accounts (
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

CREATE TABLE IF NOT EXISTS public.crm_contacts (
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

CREATE TABLE IF NOT EXISTS public.crm_opportunities (
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

CREATE TABLE IF NOT EXISTS public.crm_opportunity_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES public.crm_opportunities(id) ON DELETE CASCADE,
  pipeline_id UUID NOT NULL REFERENCES public.crm_pipelines_v2(id) ON DELETE CASCADE,
  from_stage_id UUID REFERENCES public.crm_stages_v2(id) ON DELETE SET NULL,
  to_stage_id UUID NOT NULL REFERENCES public.crm_stages_v2(id) ON DELETE RESTRICT,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_tasks (
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

CREATE TABLE IF NOT EXISTS public.crm_activities (
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

CREATE TABLE IF NOT EXISTS public.crm_activity_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES public.crm_activities(id) ON DELETE CASCADE,
  linked_type TEXT NOT NULL CHECK (linked_type IN ('calendar_event', 'lead', 'deal', 'telephony_call', 'drive_node')),
  linked_id UUID NOT NULL,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, linked_type, linked_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_accounts_org ON public.crm_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_crm_contacts_org_account ON public.crm_contacts(org_id, account_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_org_pipeline_stage ON public.crm_opportunities(org_id, pipeline_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_owner ON public.crm_opportunities(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_crm_opportunities_status ON public.crm_opportunities(status);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_org_status_due ON public.crm_tasks(org_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assigned ON public.crm_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_crm_activities_org_happened ON public.crm_activities(org_id, happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_activities_opportunity ON public.crm_activities(opportunity_id, happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_stage_history_opportunity ON public.crm_opportunity_stage_history(opportunity_id, changed_at DESC);

ALTER TABLE public.crm_pipelines_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_stages_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_opportunity_stage_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activity_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm_v2_pipelines_org" ON public.crm_pipelines_v2;
CREATE POLICY "crm_v2_pipelines_org" ON public.crm_pipelines_v2 FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "crm_v2_stages_org" ON public.crm_stages_v2;
CREATE POLICY "crm_v2_stages_org" ON public.crm_stages_v2 FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.crm_pipelines_v2 p WHERE p.id = crm_stages_v2.pipeline_id AND public.is_org_member(p.org_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.crm_pipelines_v2 p WHERE p.id = crm_stages_v2.pipeline_id AND public.is_org_member(p.org_id)));

DROP POLICY IF EXISTS "crm_v2_accounts_org" ON public.crm_accounts;
CREATE POLICY "crm_v2_accounts_org" ON public.crm_accounts FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "crm_v2_contacts_org" ON public.crm_contacts;
CREATE POLICY "crm_v2_contacts_org" ON public.crm_contacts FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "crm_v2_opportunities_org" ON public.crm_opportunities;
CREATE POLICY "crm_v2_opportunities_org" ON public.crm_opportunities FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "crm_v2_stage_history_org" ON public.crm_opportunity_stage_history;
CREATE POLICY "crm_v2_stage_history_org" ON public.crm_opportunity_stage_history FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "crm_v2_tasks_org" ON public.crm_tasks;
CREATE POLICY "crm_v2_tasks_org" ON public.crm_tasks FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "crm_v2_activities_org" ON public.crm_activities;
CREATE POLICY "crm_v2_activities_org" ON public.crm_activities FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "crm_v2_activity_links_org" ON public.crm_activity_links;
CREATE POLICY "crm_v2_activity_links_org" ON public.crm_activity_links FOR ALL TO authenticated
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

GRANT ALL ON public.crm_pipelines_v2 TO authenticated, service_role;
GRANT ALL ON public.crm_stages_v2 TO authenticated, service_role;
GRANT ALL ON public.crm_accounts TO authenticated, service_role;
GRANT ALL ON public.crm_contacts TO authenticated, service_role;
GRANT ALL ON public.crm_opportunities TO authenticated, service_role;
GRANT ALL ON public.crm_opportunity_stage_history TO authenticated, service_role;
GRANT ALL ON public.crm_tasks TO authenticated, service_role;
GRANT ALL ON public.crm_activities TO authenticated, service_role;
GRANT ALL ON public.crm_activity_links TO authenticated, service_role;

-- Seed default pipeline + stages
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
  AND NOT EXISTS (SELECT 1 FROM public.crm_stages_v2 x WHERE x.pipeline_id = s.pipeline_id);


-- ===================== 016: Lead potential score =====================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS potential_score INTEGER;
CREATE INDEX IF NOT EXISTS idx_leads_potential_score ON leads(potential_score DESC NULLS LAST);


-- ===================== 018: Leads pipeline / qualification / follow-up =====================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS enrichment_step TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS prospect_analysis TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS targeted_offer TEXT
  CHECK (targeted_offer IN ('website', 'software', 'ads', 'combo', 'seo', 'other'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS identified_need TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS priority_score TEXT DEFAULT 'cold'
  CHECK (priority_score IN ('hot', 'warm', 'cold'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS estimated_budget TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS decision_maker_confirmed BOOLEAN DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS pipeline_status TEXT DEFAULT 'new'
  CHECK (pipeline_status IN ('new','to_contact','contacted','responded','demo_sent','proposal_sent','negotiation','won','lost','not_interested'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS first_contact_date DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_contact_date DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_action TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS next_action_date DATE;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contact_channel TEXT
  CHECK (contact_channel IN ('email','phone','linkedin','in_person','social','other'));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contact_attempts INTEGER DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS demo_site_created BOOLEAN DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS demo_site_url TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS quote_sent BOOLEAN DEFAULT false;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS quote_amount TEXT;

CREATE INDEX IF NOT EXISTS idx_leads_pipeline_status ON public.leads(pipeline_status);
CREATE INDEX IF NOT EXISTS idx_leads_priority_score ON public.leads(priority_score);
CREATE INDEX IF NOT EXISTS idx_leads_next_action_date ON public.leads(next_action_date);
CREATE INDEX IF NOT EXISTS idx_leads_enrichment_step ON public.leads(enrichment_step);


-- ===================== DONE =====================
-- The CRM should now work. Refresh the page.
