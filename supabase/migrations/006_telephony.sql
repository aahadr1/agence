-- Twilio call log + agent callback numbers (2–5 employés)

create table if not exists public.telephony_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  phone_e164 text not null,
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.telephony_calls (
  id uuid primary key default gen_random_uuid(),
  call_sid text not null unique,
  parent_call_sid text,
  direction text,
  from_number text,
  to_number text,
  status text,
  initiated_by uuid references auth.users (id) on delete set null,
  recording_url text,
  recording_sid text,
  recording_duration_sec integer,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telephony_calls_created_at_idx on public.telephony_calls (created_at desc);
create index if not exists telephony_calls_initiated_by_idx on public.telephony_calls (initiated_by);

alter table public.telephony_agents enable row level security;
alter table public.telephony_calls enable row level security;

-- Agents: chaque utilisateur lit/écrit sa propre ligne ; petite équipe peut tout lire
create policy "telephony_agents_select_own"
  on public.telephony_agents for select
  to authenticated
  using (true);

create policy "telephony_agents_insert_own"
  on public.telephony_agents for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "telephony_agents_update_own"
  on public.telephony_agents for update
  to authenticated
  using (auth.uid() = user_id);

create policy "telephony_agents_delete_own"
  on public.telephony_agents for delete
  to authenticated
  using (auth.uid() = user_id);

-- Calls: visibles par toute l’équipe connectée (même org implicite)
create policy "telephony_calls_select_authenticated"
  on public.telephony_calls for select
  to authenticated
  using (true);

-- Insert / update via service role (webhooks) uniquement — pas de policy insert anon

comment on table public.telephony_agents is 'Numéro mobile/fixe pour click-to-call Twilio';
comment on table public.telephony_calls is 'Historique des appels et enregistrements Twilio';
