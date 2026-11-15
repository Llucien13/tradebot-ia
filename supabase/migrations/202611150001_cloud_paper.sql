create table if not exists public.cloud_paper_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  state jsonb not null,
  strategy jsonb not null,
  running boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cloud_paper_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null,
  event_type text not null check (event_type in ('SIGNAL', 'POSITION_OPENED', 'POSITION_CLOSED', 'ENTRY_CANCELLED')),
  occurred_at timestamptz not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists cloud_paper_events_user_time_idx
  on public.cloud_paper_events (user_id, occurred_at desc);

alter table public.cloud_paper_accounts enable row level security;
alter table public.cloud_paper_events enable row level security;

drop policy if exists cloud_paper_accounts_read_own on public.cloud_paper_accounts;
create policy cloud_paper_accounts_read_own on public.cloud_paper_accounts
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists cloud_paper_events_read_own on public.cloud_paper_events;
create policy cloud_paper_events_read_own on public.cloud_paper_events
  for select to authenticated using (auth.uid() = user_id);

revoke all on public.cloud_paper_accounts from anon, authenticated;
revoke all on public.cloud_paper_events from anon, authenticated;
grant select on public.cloud_paper_accounts, public.cloud_paper_events to authenticated;
grant all on public.cloud_paper_accounts, public.cloud_paper_events to service_role;

create or replace function public.cloud_paper_commit_cycle(
  p_user_id uuid,
  p_expected_revision bigint,
  p_state jsonb,
  p_events jsonb,
  p_updated_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision bigint;
  event jsonb;
begin
  select revision into current_revision
  from public.cloud_paper_accounts
  where user_id = p_user_id
  for update;

  if not found or current_revision <> p_expected_revision then
    return false;
  end if;

  update public.cloud_paper_accounts
  set state = p_state,
      running = coalesce((p_state ->> 'running')::boolean, false),
      revision = revision + 1,
      updated_at = p_updated_at
  where user_id = p_user_id;

  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'Cloud PAPER events must be an array';
  end if;

  for event in select value from jsonb_array_elements(p_events)
  loop
    insert into public.cloud_paper_events (user_id, event_id, event_type, occurred_at, payload)
    values (
      p_user_id,
      event ->> 'event_id',
      event ->> 'event_type',
      (event ->> 'occurred_at')::timestamptz,
      event -> 'payload'
    )
    on conflict (user_id, event_id) do nothing;
  end loop;

  return true;
end;
$$;

revoke all on function public.cloud_paper_commit_cycle(uuid, bigint, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.cloud_paper_commit_cycle(uuid, bigint, jsonb, jsonb, timestamptz) to service_role;
