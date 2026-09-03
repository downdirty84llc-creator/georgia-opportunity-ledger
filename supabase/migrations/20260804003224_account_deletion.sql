-- Recovered from the live database (project bbgikfblcahhvrpxiqnd), applied
-- 2026-08-04 and never committed. Reproduced verbatim from the statement
-- Supabase recorded in supabase_migrations.schema_migrations.
--
-- Adds member-initiated account closure. The privilege guard is widened by
-- exactly one hole: a member may flip their own account_status between
-- 'active' and 'closed', and only in lockstep with deletion_requested_at. Every
-- other status change, every role change and every access-rank override still
-- requires a super administrator.

create or replace function public.guard_profile_privilege_changes()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.has_role('super_administrator') then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Role changes require a super administrator'
      using errcode = 'insufficient_privilege';
  end if;

  if new.account_status is distinct from old.account_status then
    if not (
      new.id = auth.uid()
      and (
        (old.account_status = 'active'
         and new.account_status = 'closed'
         and old.deletion_requested_at is null
         and new.deletion_requested_at is not null)
        or
        (old.account_status = 'closed'
         and new.account_status = 'active'
         and old.deletion_requested_at is not null
         and new.deletion_requested_at is null)
      )
    ) then
      raise exception 'Account status changes require a super administrator'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if new.access_rank_override is distinct from old.access_rank_override
     or new.access_rank_override_expires_at
        is distinct from old.access_rank_override_expires_at then
    raise exception 'Access overrides require a super administrator'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create or replace function public.request_account_deletion()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  current_status public.account_status;
begin
  if caller is null then
    raise exception 'Authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  select account_status into current_status
  from public.profiles where id = caller;

  if current_status is null then
    raise exception 'No such account' using errcode = 'no_data_found';
  end if;

  if current_status <> 'active' then
    raise exception 'Only an active account may be closed from here'
      using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
  set deletion_requested_at = now(),
      account_status = 'closed'
  where id = caller;

  perform public.write_audit_log(
    'user.deletion_requested', 'profile', caller,
    jsonb_build_object('account_status', current_status),
    jsonb_build_object('account_status', 'closed',
                       'deletion_requested_at', now())
  );
end;
$$;

create or replace function public.cancel_account_deletion()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  caller uuid := auth.uid();
  requested timestamptz;
begin
  if caller is null then
    raise exception 'Authentication required'
      using errcode = 'insufficient_privilege';
  end if;

  select deletion_requested_at into requested
  from public.profiles where id = caller;

  if requested is null then
    raise exception 'No deletion request to withdraw'
      using errcode = 'no_data_found';
  end if;

  update public.profiles
  set deletion_requested_at = null,
      account_status = 'active'
  where id = caller;

  perform public.write_audit_log(
    'user.deletion_cancelled', 'profile', caller,
    jsonb_build_object('deletion_requested_at', requested),
    jsonb_build_object('account_status', 'active')
  );
end;
$$;

revoke all on function public.request_account_deletion() from public, anon;
revoke all on function public.cancel_account_deletion() from public, anon;
grant execute on function public.request_account_deletion()
  to authenticated, service_role;
grant execute on function public.cancel_account_deletion()
  to authenticated, service_role;

create or replace function public.accounts_due_for_purge(p_grace_days integer)
returns table (id uuid, deletion_requested_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p.id, p.deletion_requested_at
  from public.profiles p
  where p.deletion_requested_at is not null
    and p.account_status = 'closed'
    and p.deletion_requested_at
        < now() - make_interval(days => greatest(p_grace_days, 0))
  order by p.deletion_requested_at
  limit 500;
$$;

revoke all on function public.accounts_due_for_purge(integer)
  from public, anon, authenticated;
grant execute on function public.accounts_due_for_purge(integer) to service_role;
