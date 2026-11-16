create table if not exists public.paper_monitor_snapshots (
  user_id uuid primary key references auth.users (id) on delete cascade,
  snapshot jsonb not null check (
    snapshot ->> 'mode' is not distinct from 'PAPER'
    and snapshot ->> 'liveEnabled' is not distinct from 'false'
    and snapshot ->> 'readOnly' is not distinct from 'true'
  ),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.paper_monitor_trades (
  user_id uuid not null references auth.users (id) on delete cascade,
  trade_id text not null,
  occurred_at timestamptz not null,
  payload jsonb not null check (jsonb_typeof(payload -> 'trade') = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, trade_id)
);

create index if not exists paper_monitor_trades_user_time_idx
  on public.paper_monitor_trades (user_id, occurred_at desc, trade_id);

alter table public.paper_monitor_snapshots enable row level security;
alter table public.paper_monitor_trades enable row level security;

drop policy if exists paper_monitor_snapshots_read_own on public.paper_monitor_snapshots;
create policy paper_monitor_snapshots_read_own on public.paper_monitor_snapshots
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists paper_monitor_trades_read_own on public.paper_monitor_trades;
create policy paper_monitor_trades_read_own on public.paper_monitor_trades
  for select to authenticated using (auth.uid() = user_id);

revoke all on public.paper_monitor_snapshots from anon, authenticated;
revoke all on public.paper_monitor_trades from anon, authenticated;
grant select on public.paper_monitor_snapshots, public.paper_monitor_trades to authenticated;
grant all on public.paper_monitor_snapshots, public.paper_monitor_trades to service_role;

create or replace function public.cloud_paper_monitor_sync(
  p_user_id uuid,
  p_snapshot jsonb,
  p_trades jsonb
) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  sync_time timestamptz := now();
begin
  if p_user_id is null
      or jsonb_typeof(p_snapshot) is distinct from 'object'
      or p_snapshot ->> 'mode' is distinct from 'PAPER'
      or p_snapshot ->> 'liveEnabled' is distinct from 'false'
      or p_snapshot ->> 'readOnly' is distinct from 'true'
      or jsonb_typeof(p_trades) is distinct from 'array'
      or jsonb_array_length(p_trades) > 100 then
    raise exception 'Invalid read-only PAPER sync payload';
  end if;

  insert into public.paper_monitor_snapshots (user_id, snapshot, synced_at)
  values (p_user_id, p_snapshot, sync_time)
  on conflict (user_id) do update
    set snapshot = excluded.snapshot, synced_at = excluded.synced_at;

  for item in select value from jsonb_array_elements(p_trades)
  loop
    if jsonb_typeof(item) is distinct from 'object'
        or jsonb_typeof(item -> 'trade') is distinct from 'object'
        or jsonb_typeof(item -> 'needsReview') is distinct from 'boolean'
        or length(coalesce(item ->> 'id', '')) = 0
        or length(item ->> 'id') > 100 then
      raise exception 'Invalid PAPER trade in sync payload';
    end if;
    insert into public.paper_monitor_trades (user_id, trade_id, occurred_at, payload, updated_at)
    values (
      p_user_id,
      item ->> 'id',
      coalesce(
        nullif(item -> 'trade' ->> 'exitTime', '')::double precision,
        (item -> 'trade' ->> 'entryTime')::double precision
      ) * interval '1 second' + timestamptz 'epoch',
      item,
      sync_time
    )
    on conflict (user_id, trade_id) do update
      set occurred_at = excluded.occurred_at,
          payload = excluded.payload,
          updated_at = excluded.updated_at;
  end loop;

  return sync_time;
end;
$$;

create or replace function public.cloud_paper_monitor_journal(
  p_user_id uuid,
  p_limit integer,
  p_offset integer
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.paper_monitor_trades where user_id = p_user_id),
    'offset', p_offset,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', page.trade_id,
          'needsReview', page.payload -> 'needsReview',
          'trade', page.payload -> 'trade'
        ) order by page.occurred_at desc, page.trade_id
      )
      from (
        select trade_id, occurred_at, payload
        from public.paper_monitor_trades
        where user_id = p_user_id
        order by occurred_at desc, trade_id
        limit least(greatest(coalesce(p_limit, 50), 1), 100)
        offset least(greatest(coalesce(p_offset, 0), 0), 1000000)
      ) page
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.cloud_paper_monitor_sync(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.cloud_paper_monitor_journal(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.cloud_paper_monitor_sync(uuid, jsonb, jsonb) to service_role;
grant execute on function public.cloud_paper_monitor_journal(uuid, integer, integer) to service_role;
