-- Projects + variants (idempotent: safe if objects already exist from a prior run)

CREATE TABLE IF NOT EXISTS public.projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  business_info   jsonb not null default '{}',
  status          text not null default 'info_gathering'
                  check (status in ('info_gathering', 'ideation', 'selection', 'completed')),
  selected_variant_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own projects" ON public.projects;
CREATE POLICY "Users can view own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own projects" ON public.projects;
CREATE POLICY "Users can create own projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own projects" ON public.projects;
CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own projects" ON public.projects;
CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.variants (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  prompt        text not null,
  image_url     text,
  theme_name    text not null default '',
  color_scheme  jsonb,
  selected      boolean not null default false,
  created_at    timestamptz not null default now()
);

ALTER TABLE public.variants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own variants" ON public.variants;
CREATE POLICY "Users can view own variants"
  ON public.variants FOR SELECT
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can create own variants" ON public.variants;
CREATE POLICY "Users can create own variants"
  ON public.variants FOR INSERT
  WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users can update own variants" ON public.variants;
CREATE POLICY "Users can update own variants"
  ON public.variants FOR UPDATE
  USING (
    project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid())
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_selected_variant'
      AND conrelid = 'public.projects'::regclass
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT fk_selected_variant
      FOREIGN KEY (selected_variant_id) REFERENCES public.variants(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_user_id ON public.projects(user_id);
CREATE INDEX IF NOT EXISTS idx_variants_project_id ON public.variants(project_id);
