-- Project images table (logo + business photos)
create table public.project_images (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  storage_path text not null,
  url         text not null,
  type        text not null check (type in ('logo', 'photo')),
  analysis    jsonb,
  created_at  timestamptz not null default now()
);

alter table public.project_images enable row level security;

create policy "Users can view own project images"
  on public.project_images for select
  using (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create policy "Users can insert own project images"
  on public.project_images for insert
  with check (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create policy "Users can update own project images"
  on public.project_images for update
  using (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create policy "Users can delete own project images"
  on public.project_images for delete
  using (
    project_id in (select id from public.projects where user_id = auth.uid())
  );

create index idx_project_images_project_id on public.project_images(project_id);

-- Add user_colors and user_instructions to projects
alter table public.projects
  add column user_colors jsonb default '[]',
  add column user_instructions text default '';
