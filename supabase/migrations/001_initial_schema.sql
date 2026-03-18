-- Projects table
create table public.projects (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  business_info   jsonb not null default '{}',
  status          text not null default 'info_gathering'
                  check (status in ('info_gathering', 'ideation', 'selection', 'completed')),
  selected_variant_id uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Row Level Security for projects
alter table public.projects enable row level security;

create policy "Users can view own projects"
  on public.projects for select
  using (auth.uid() = user_id);

create policy "Users can create own projects"
  on public.projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update own projects"
  on public.projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own projects"
  on public.projects for delete
  using (auth.uid() = user_id);

-- Variants table
create table public.variants (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  prompt        text not null,
  image_url     text,
  theme_name    text not null default '',
  color_scheme  jsonb,
  selected      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Row Level Security for variants
alter table public.variants enable row level security;

create policy "Users can view own variants"
  on public.variants for select
  using (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create policy "Users can create own variants"
  on public.variants for insert
  with check (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create policy "Users can update own variants"
  on public.variants for update
  using (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

-- Add FK from projects.selected_variant_id -> variants.id
alter table public.projects
  add constraint fk_selected_variant
  foreign key (selected_variant_id) references public.variants(id);

-- Indexes
create index idx_projects_user_id on public.projects(user_id);
create index idx_variants_project_id on public.variants(project_id);
