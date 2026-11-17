-- One row per password-reset link, kept by the hash of its token so the table never holds a
-- usable link. A link works once (used_at) and for one hour (expires_at). Service role only.
create table public.aircheck_password_resets (
  token_hash text primary key,
  user_id text not null references public.aircheck_users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index aircheck_password_resets_user on public.aircheck_password_resets(user_id);
alter table public.aircheck_password_resets enable row level security;
revoke all on public.aircheck_password_resets from anon, authenticated;
