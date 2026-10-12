-- A provider deletion cannot share the cancellation transaction. Persist the
-- decision under the profile lock, then keep the account closed across retries.
create table public.account_purge_claims (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  deletion_requested_at timestamptz not null,
  claimed_at timestamptz not null default clock_timestamp()
);
alter table public.account_purge_claims enable row level security;
revoke all on table public.account_purge_claims
  from public, anon, authenticated, service_role;

create function public.guard_account_purge_claim()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if (new.id is distinct from old.id
      or new.account_status is distinct from old.account_status
      or new.deletion_requested_at is distinct from old.deletion_requested_at)
     and exists(select 1 from public.account_purge_claims where user_id = old.id) then
    -- Even staff must not reopen an account while a provider request may be
    -- in flight. A timeout does not establish whether deletion took effect.
    raise exception 'Account deletion has already started'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger guard_account_purge_claim_trigger
before update on public.profiles
for each row execute function public.guard_account_purge_claim();

create function public.claim_account_for_purge(
  p_user_id uuid, p_requested_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  requested timestamptz;
  current_status public.account_status;
begin
  -- Skip a cancellation/status change in progress; a later run can retry it.
  select deletion_requested_at, account_status into requested, current_status
  from public.profiles where id = p_user_id for update skip locked;
  if not found or requested is null or p_requested_at is null
     or requested is distinct from p_requested_at
     or current_status is distinct from 'closed'
     or requested + interval '720 hours' > clock_timestamp() then
    return false;
  end if;

  -- Write a row version as well as taking the lock. A pre-existing repeatable
  -- read transaction must serialize/retry rather than reopen from a snapshot
  -- that cannot see the new claim.
  update public.profiles set updated_at = clock_timestamp() where id = p_user_id;
  insert into public.account_purge_claims (user_id, deletion_requested_at)
  values (p_user_id, requested)
  on conflict (user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.guard_account_purge_claim()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_account_for_purge(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_account_for_purge(uuid, timestamptz)
  to service_role;

comment on table public.account_purge_claims is
  'Irreversible cleanup claims. Retained on provider failure for retry; removed by the profile cascade on successful Auth deletion. Never release a claim merely because an API call timed out.';
