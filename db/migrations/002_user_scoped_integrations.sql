alter table public.integration_connections add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.raw_events add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.metrics add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.sync_runs add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.integration_connections drop constraint if exists integration_connections_provider_external_user_id_key;
alter table public.raw_events drop constraint if exists raw_events_provider_external_id_event_type_key;
alter table public.metrics drop constraint if exists metrics_provider_external_id_type_key;

create unique index if not exists integration_connections_user_provider_external_uidx
  on public.integration_connections(user_id, provider, external_user_id) nulls not distinct;
create unique index if not exists raw_events_user_provider_external_event_uidx
  on public.raw_events(user_id, provider, external_id, event_type);
create unique index if not exists metrics_user_provider_external_type_uidx
  on public.metrics(user_id, provider, external_id, type);
create index if not exists integration_connections_user_id_idx on public.integration_connections(user_id);
create index if not exists raw_events_user_id_idx on public.raw_events(user_id);
create index if not exists metrics_user_id_recorded_at_idx on public.metrics(user_id, recorded_at desc);
create index if not exists metrics_raw_event_id_idx on public.metrics(raw_event_id);
create index if not exists sync_runs_user_id_idx on public.sync_runs(user_id);

alter table public.integration_connections enable row level security;
alter table public.raw_events enable row level security;
alter table public.metrics enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists users_manage_own_connections on public.integration_connections;
create policy users_manage_own_connections on public.integration_connections for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists users_select_own_events on public.raw_events;
drop policy if exists users_insert_own_events on public.raw_events;
create policy users_select_own_events on public.raw_events for select to authenticated
  using ((select auth.uid()) = user_id);
create policy users_insert_own_events on public.raw_events for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists users_select_own_metrics on public.metrics;
drop policy if exists users_insert_own_metrics on public.metrics;
drop policy if exists users_update_own_metrics on public.metrics;
create policy users_select_own_metrics on public.metrics for select to authenticated
  using ((select auth.uid()) = user_id);
create policy users_insert_own_metrics on public.metrics for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy users_update_own_metrics on public.metrics for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists users_select_own_sync_runs on public.sync_runs;
drop policy if exists users_insert_own_sync_runs on public.sync_runs;
create policy users_select_own_sync_runs on public.sync_runs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy users_insert_own_sync_runs on public.sync_runs for insert to authenticated
  with check ((select auth.uid()) = user_id);
