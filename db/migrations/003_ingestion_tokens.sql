create table if not exists public.ingestion_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ingestion_tokens_user_id_idx on public.ingestion_tokens(user_id);
alter table public.ingestion_tokens enable row level security;

revoke all on table public.ingestion_tokens from anon, authenticated;
grant select, update on table public.ingestion_tokens to service_role;

create policy ingestion_tokens_deny_client_access on public.ingestion_tokens
  for all to anon, authenticated using (false) with check (false);
