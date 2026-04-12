-- Single-org foundation: organizations, members, profiles, default org
-- Re-scopes existing app tables to org_id + org-based RLS

-- ---------------------------------------------------------------------------
-- Core tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX idx_organization_members_user_id ON public.organization_members(user_id);
CREATE INDEX idx_organization_members_org_id ON public.organization_members(org_id);

CREATE TABLE public.profiles (
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

CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Helper: is current user a member of org?
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members m
    WHERE m.org_id = p_org_id AND m.user_id = auth.uid()
  );
$$;

-- Organizations: members can read their org(s)
CREATE POLICY "org_select_member"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));

CREATE POLICY "org_insert_authenticated"
  ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (true);

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

-- Members: see rows for orgs you belong to
CREATE POLICY "org_members_select"
  ON public.organization_members FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

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

-- Profiles: readable by users in the same org (any shared org)
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

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT ALL ON public.organizations TO anon, authenticated, service_role;
GRANT ALL ON public.organization_members TO anon, authenticated, service_role;
GRANT ALL ON public.profiles TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Default org (stable id for triggers + backfill)
-- ---------------------------------------------------------------------------

INSERT INTO public.organizations (id, name, slug)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Agency',
  'agency'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Add org_id to existing domain tables
-- ---------------------------------------------------------------------------

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

-- Backfill
UPDATE public.projects SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.lead_searches SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.leads SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.lead_lists SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.business_analyses SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.telephony_agents SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;
UPDATE public.telephony_calls SET org_id = '00000000-0000-4000-8000-000000000001' WHERE org_id IS NULL;

ALTER TABLE public.projects ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.lead_searches ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.leads ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.lead_lists ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.business_analyses ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.telephony_agents ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.telephony_calls ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_org_id ON public.projects(org_id);
CREATE INDEX IF NOT EXISTS idx_lead_searches_org_id ON public.lead_searches(org_id);
CREATE INDEX IF NOT EXISTS idx_leads_org_id ON public.leads(org_id);
CREATE INDEX IF NOT EXISTS idx_lead_lists_org_id ON public.lead_lists(org_id);
CREATE INDEX IF NOT EXISTS idx_business_analyses_org_id ON public.business_analyses(org_id);
CREATE INDEX IF NOT EXISTS idx_telephony_agents_org_id ON public.telephony_agents(org_id);
CREATE INDEX IF NOT EXISTS idx_telephony_calls_org_id ON public.telephony_calls(org_id);

-- ---------------------------------------------------------------------------
-- Seed organization_members + profiles from existing data
-- ---------------------------------------------------------------------------

INSERT INTO public.profiles (user_id, display_name)
SELECT u.id, split_part(COALESCE(u.email, ''), '@', 1)
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id);

-- Collect distinct user ids from app tables
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

-- Promote one owner (earliest project creator, else any member)
WITH first_owner AS (
  SELECT user_id FROM public.projects
  WHERE org_id = '00000000-0000-4000-8000-000000000001'
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1
),
pick AS (
  SELECT user_id FROM first_owner
  UNION ALL
  SELECT user_id FROM public.organization_members
  WHERE org_id = '00000000-0000-4000-8000-000000000001'
  LIMIT 1
)
UPDATE public.organization_members om
SET role = 'owner'
FROM pick
WHERE om.org_id = '00000000-0000-4000-8000-000000000001'
  AND om.user_id = pick.user_id
  AND NOT EXISTS (
    SELECT 1 FROM public.organization_members o2
    WHERE o2.org_id = om.org_id AND o2.role = 'owner'
  );

-- ---------------------------------------------------------------------------
-- New user → profile + default org membership (first user becomes owner)
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- RLS: projects + children (org-scoped)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can create own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;

CREATE POLICY "projects_select_org"
  ON public.projects FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY "projects_insert_org"
  ON public.projects FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(org_id) AND auth.uid() = user_id
  );

CREATE POLICY "projects_update_org"
  ON public.projects FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "projects_delete_org"
  ON public.projects FOR DELETE TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Users can view own variants" ON public.variants;
DROP POLICY IF EXISTS "Users can create own variants" ON public.variants;
DROP POLICY IF EXISTS "Users can update own variants" ON public.variants;

CREATE POLICY "variants_select_org"
  ON public.variants FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = variants.project_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "variants_insert_org"
  ON public.variants FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = variants.project_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "variants_update_org"
  ON public.variants FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = variants.project_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "variants_delete_org"
  ON public.variants FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = variants.project_id AND public.is_org_member(p.org_id)
    )
  );

DROP POLICY IF EXISTS "Users can view own project images" ON public.project_images;
DROP POLICY IF EXISTS "Users can insert own project images" ON public.project_images;
DROP POLICY IF EXISTS "Users can update own project images" ON public.project_images;
DROP POLICY IF EXISTS "Users can delete own project images" ON public.project_images;

CREATE POLICY "project_images_select_org"
  ON public.project_images FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_images.project_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "project_images_insert_org"
  ON public.project_images FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_images.project_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "project_images_update_org"
  ON public.project_images FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_images.project_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "project_images_delete_org"
  ON public.project_images FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_images.project_id AND public.is_org_member(p.org_id)
    )
  );

DROP POLICY IF EXISTS "Users can view own website builds" ON public.website_builds;
DROP POLICY IF EXISTS "Users can insert own website builds" ON public.website_builds;
DROP POLICY IF EXISTS "Users can update own website builds" ON public.website_builds;

CREATE POLICY "website_builds_select_org"
  ON public.website_builds FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = website_builds.project_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "website_builds_insert_org"
  ON public.website_builds FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = website_builds.project_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "website_builds_update_org"
  ON public.website_builds FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = website_builds.project_id AND public.is_org_member(p.org_id)
    )
  );

CREATE POLICY "website_builds_delete_org"
  ON public.website_builds FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = website_builds.project_id AND public.is_org_member(p.org_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Leads + lists (org-scoped)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view own searches" ON public.lead_searches;
DROP POLICY IF EXISTS "Users can insert own searches" ON public.lead_searches;
DROP POLICY IF EXISTS "Users can update own searches" ON public.lead_searches;

CREATE POLICY "lead_searches_select_org"
  ON public.lead_searches FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY "lead_searches_insert_org"
  ON public.lead_searches FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);

CREATE POLICY "lead_searches_update_org"
  ON public.lead_searches FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Users can view own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can insert own leads" ON public.leads;
DROP POLICY IF EXISTS "Users can delete own leads" ON public.leads;

CREATE POLICY "leads_select_org"
  ON public.leads FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY "leads_insert_org"
  ON public.leads FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);

CREATE POLICY "leads_update_org"
  ON public.leads FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "leads_delete_org"
  ON public.leads FOR DELETE TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS "Users can manage own lists" ON public.lead_lists;
DROP POLICY IF EXISTS "Users can manage own list items" ON public.lead_list_items;

CREATE POLICY "lead_lists_all_org"
  ON public.lead_lists FOR ALL TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);

CREATE POLICY "lead_list_items_all_org"
  ON public.lead_list_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lead_lists l
      WHERE l.id = lead_list_items.list_id AND public.is_org_member(l.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.lead_lists l
      WHERE l.id = lead_list_items.list_id AND public.is_org_member(l.org_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Business analyses (org-scoped)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can read own analyses" ON public.business_analyses;
DROP POLICY IF EXISTS "Users can insert own analyses" ON public.business_analyses;
DROP POLICY IF EXISTS "Users can update own analyses" ON public.business_analyses;

CREATE POLICY "business_analyses_select_org"
  ON public.business_analyses FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY "business_analyses_insert_org"
  ON public.business_analyses FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);

CREATE POLICY "business_analyses_update_org"
  ON public.business_analyses FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));

CREATE POLICY "business_analyses_delete_org"
  ON public.business_analyses FOR DELETE TO authenticated
  USING (public.is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Telephony (org-scoped)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "telephony_agents_select_own" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_agents_insert_own" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_agents_update_own" ON public.telephony_agents;
DROP POLICY IF EXISTS "telephony_agents_delete_own" ON public.telephony_agents;

CREATE POLICY "telephony_agents_select_org"
  ON public.telephony_agents FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

CREATE POLICY "telephony_agents_insert_org"
  ON public.telephony_agents FOR INSERT TO authenticated
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);

CREATE POLICY "telephony_agents_update_org"
  ON public.telephony_agents FOR UPDATE TO authenticated
  USING (public.is_org_member(org_id) AND auth.uid() = user_id)
  WITH CHECK (public.is_org_member(org_id) AND auth.uid() = user_id);

CREATE POLICY "telephony_agents_delete_org"
  ON public.telephony_agents FOR DELETE TO authenticated
  USING (public.is_org_member(org_id) AND auth.uid() = user_id);

DROP POLICY IF EXISTS "telephony_calls_select_authenticated" ON public.telephony_calls;

CREATE POLICY "telephony_calls_select_org"
  ON public.telephony_calls FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
