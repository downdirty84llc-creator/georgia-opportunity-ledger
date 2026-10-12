-- Enforce the same 30 * 24-hour grace window for RPCs and direct profile
-- updates. An application-only check is bypassable through PostgREST.
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

  if new.account_status is distinct from old.account_status
     or new.deletion_requested_at is distinct from old.deletion_requested_at then
    if new.id = auth.uid()
       and old.account_status = 'active' and new.account_status = 'closed'
       and old.deletion_requested_at is null
       and new.deletion_requested_at is not null then
      -- The member cannot backdate a request or move its deadline.
      new.deletion_requested_at := clock_timestamp();
    elsif new.id = auth.uid()
       and old.account_status = 'closed' and new.account_status = 'active'
       and old.deletion_requested_at is not null
       and new.deletion_requested_at is null
       and old.deletion_requested_at <= clock_timestamp()
       and old.deletion_requested_at + interval '720 hours' > clock_timestamp() then
      null;
    else
      raise exception 'Account status and deletion date changes require a current deletion transition or a super administrator'
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
  requested timestamptz;
begin
  if caller is null then
    raise exception 'Authentication required'
      using errcode = 'insufficient_privilege';
  end if;
  select account_status into current_status
  from public.profiles where id = caller for update;
  if current_status is null then
    raise exception 'No such account' using errcode = 'no_data_found';
  end if;
  if current_status <> 'active' then
    raise exception 'Only an active account may be closed from here'
      using errcode = 'insufficient_privilege';
  end if;
  update public.profiles
  set deletion_requested_at = clock_timestamp(), account_status = 'closed'
  where id = caller
  returning deletion_requested_at into requested;
  perform public.write_audit_log(
    'user.deletion_requested', 'profile', caller,
    jsonb_build_object('account_status', current_status),
    jsonb_build_object('account_status', 'closed', 'deletion_requested_at', requested)
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
  current_status public.account_status;
begin
  if caller is null then
    raise exception 'Authentication required'
      using errcode = 'insufficient_privilege';
  end if;
  -- Check after acquiring the row lock: a concurrent status change or a
  -- deadline reached while waiting must not be overwritten by this RPC.
  select deletion_requested_at, account_status into requested, current_status
  from public.profiles where id = caller for update;
  if current_status is distinct from 'closed' or requested is null
     or requested > clock_timestamp()
     or requested + interval '720 hours' <= clock_timestamp() then
    raise exception 'No current deletion request to withdraw'
      using errcode = 'no_data_found';
  end if;
  update public.profiles
  set deletion_requested_at = null, account_status = 'active'
  where id = caller;
  perform public.write_audit_log(
    'user.deletion_cancelled', 'profile', caller,
    jsonb_build_object('deletion_requested_at', requested),
    jsonb_build_object('account_status', 'active')
  );
end;
$$;

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
    -- A caller may retain data longer, but cannot shorten the promised window.
    and p.deletion_requested_at <= now()
      - greatest(coalesce(p_grace_days, 30), 30) * interval '24 hours'
  order by p.deletion_requested_at
  limit 500;
$$;

revoke all on function public.guard_profile_privilege_changes()
  from public, anon, authenticated;
revoke all on function public.request_account_deletion() from public, anon;
revoke all on function public.cancel_account_deletion() from public, anon;
grant execute on function public.request_account_deletion(),
  public.cancel_account_deletion() to authenticated, service_role;
revoke all on function public.accounts_due_for_purge(integer)
  from public, anon, authenticated;
grant execute on function public.accounts_due_for_purge(integer) to service_role;
