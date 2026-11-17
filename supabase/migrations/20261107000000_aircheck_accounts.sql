-- Migration "aircheck_accounts", 2026-11-07.
-- Aircheck's hosted account: users sign in with an email and password, and the account holds their
-- manifests (JSON only, never media). Only the server's service role touches these tables.
create table public.aircheck_users (
  id text primary key,
  email text not null unique,
  hash text not null,
  salt text not null,
  created_at timestamptz not null default now()
);
create table public.aircheck_sessions (
  token_hash text primary key,
  user_id text not null references public.aircheck_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index aircheck_sessions_user on public.aircheck_sessions(user_id);
create table public.aircheck_tokens (
  hash text primary key,
  account text not null references public.aircheck_users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index aircheck_tokens_account on public.aircheck_tokens(account);
create table public.aircheck_manifests (
  account text not null references public.aircheck_users(id) on delete cascade,
  day text not null,
  id text not null,
  manifest jsonb not null,
  origin text,
  updated_at timestamptz not null default now(),
  primary key (account, day, id),
  constraint aircheck_manifest_size check (pg_column_size(manifest) < 65536)
);
alter table public.aircheck_users enable row level security;
alter table public.aircheck_sessions enable row level security;
alter table public.aircheck_tokens enable row level security;
alter table public.aircheck_manifests enable row level security;
revoke all on public.aircheck_users, public.aircheck_sessions, public.aircheck_tokens, public.aircheck_manifests from anon, authenticated;
