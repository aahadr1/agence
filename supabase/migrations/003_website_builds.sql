-- Website builds table
create table public.website_builds (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete cascade,
  variant_id            uuid not null references public.variants(id),
  status                text not null default 'pending'
                        check (status in ('pending', 'generating_foundation', 'generating_pages', 'deploying', 'deployed', 'failed')),
  files                 jsonb not null default '[]',
  vercel_url            text,
  vercel_deployment_id  text,
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.website_builds enable row level security;

create policy "Users can view own website builds"
  on public.website_builds for select
  using (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create policy "Users can insert own website builds"
  on public.website_builds for insert
  with check (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create policy "Users can update own website builds"
  on public.website_builds for update
  using (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create index idx_website_builds_project_id on public.website_builds(project_id);

-- Expand project status to include building/deployed
alter table public.projects drop constraint projects_status_check;
alter table public.projects add constraint projects_status_check
  check (status in ('info_gathering', 'ideation', 'selection', 'completed', 'building', 'deployed'));
