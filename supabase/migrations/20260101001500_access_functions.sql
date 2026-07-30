-- ---------------------------------------------------------------------------
-- 0015 — Access resolution (spec 9)
--
-- These functions are the database's copy of the access rules. The API layer
-- enforces the same rules in TypeScript (src/lib/access) so that a mistake in
-- one layer does not silently expose restricted content; the two are kept in
-- step by the unit tests in tests/unit/access.
--
-- Every function is SECURITY DEFINER because it reads tables that are
-- themselves protected by row-level security, and a policy that called an
-- INVOKER function over the same table would recurse.
-- ---------------------------------------------------------------------------

-- Rank granted to staff for content-visibility purposes. Higher than any plan
-- so staff can preview every tier. Staff *permissions* (publish, refund,
-- suspend) are role checks, never rank checks.
create or replace function public.staff_access_rank()
returns integer
language sql
immutable
as $$ select 100; $$;

-- Days a past-due subscription keeps paid access while Stripe retries payment.
create or replace function public.past_due_grace_period()
returns interval
language sql
immutable
as $$ select interval '3 days'; $$;

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, extensions
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_account_status()
returns public.account_status
language sql
stable
security definer
set search_path = public, extensions
as $$
  select account_status from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid())
      in ('researcher', 'reviewer', 'editor', 'support_representative',
          'billing_manager', 'super_administrator'),
    false
  );
$$;

create or replace function public.has_role(variadic wanted public.user_role[])
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) = any(wanted),
    false
  );
$$;

-- Can this account use member features at all? Suspended and closed accounts
-- lose member content, exports and alerts (spec 9).
create or replace function public.account_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (select account_status from public.profiles where id = auth.uid()) = 'active',
    false
  );
$$;

-- Rank derived purely from the subscription record, ignoring role and override.
create or replace function public.subscription_access_rank(target_user uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  sub record;
  plan_rank integer;
begin
  select s.status, s.current_period_end, s.cancel_at_period_end, p.access_rank
    into sub
  from public.subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.user_id = target_user;

  if not found then
    return 0;
  end if;

  plan_rank := sub.access_rank;

  return case sub.status
    -- Paid and in good standing.
    when 'active' then plan_rank
    when 'trialing' then plan_rank

    -- Stripe is retrying. Keep access through the paid period plus a short
    -- grace window, then drop to free.
    when 'past_due' then
      case
        when sub.current_period_end is null then plan_rank
        when now() <= sub.current_period_end + public.past_due_grace_period()
          then plan_rank
        else 0
      end

    -- Cancelled but already paid through the end of the period.
    when 'canceled' then
      case
        when sub.current_period_end is not null and now() <= sub.current_period_end
          then plan_rank
        else 0
      end

    -- No paid access.
    else 0
  end;
end;
$$;

-- The rank the application should actually enforce for a user.
create or replace function public.effective_access_rank(target_user uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  prof record;
  rank integer;
begin
  select role, account_status, access_rank_override,
         access_rank_override_expires_at
    into prof
  from public.profiles
  where id = target_user;

  if not found then
    return 0;
  end if;

  -- A suspended or closed account keeps its saved records but loses every
  -- paid capability, including staff content previews.
  if prof.account_status <> 'active' then
    return 0;
  end if;

  if prof.role in ('researcher', 'reviewer', 'editor', 'support_representative',
                   'billing_manager', 'super_administrator') then
    return public.staff_access_rank();
  end if;

  rank := public.subscription_access_rank(target_user);

  if prof.access_rank_override is not null
     and (prof.access_rank_override_expires_at is null
          or prof.access_rank_override_expires_at > now())
  then
    rank := greatest(rank, prof.access_rank_override);
  end if;

  return rank;
end;
$$;

-- Convenience wrapper for policies.
create or replace function public.my_access_rank()
returns integer
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(public.effective_access_rank(auth.uid()), 0);
$$;

-- The opportunity visibility rule from spec 9, expressed once.
create or replace function public.can_view_opportunity(
  p_workflow_status public.workflow_status,
  p_is_restricted boolean,
  p_minimum_access_rank integer
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    public.is_staff()
    or (
      p_workflow_status = 'published'
      and p_is_restricted = false
      and public.my_access_rank() >= p_minimum_access_rank
    );
$$;
