-- Preserve issued unsubscribe links across signing-key and hosting changes.
-- Store only SHA-256 digests of the complete signed token, never the token/key.
create table public.email_unsubscribe_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  scope text not null check (scope in ('alerts', 'marketing', 'all')),
  created_at timestamptz not null default now()
);
create index email_unsubscribe_tokens_user_idx
  on public.email_unsubscribe_tokens(user_id);
alter table public.email_unsubscribe_tokens enable row level security;
revoke all on public.email_unsubscribe_tokens from public, anon, authenticated, service_role;
grant select, insert on public.email_unsubscribe_tokens to service_role;
comment on table public.email_unsubscribe_tokens is
  'Service-only digests of valid unsubscribe tokens. Retained until profile deletion so old email links keep working.';
