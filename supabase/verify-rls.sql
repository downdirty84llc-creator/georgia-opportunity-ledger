-- ---------------------------------------------------------------------------
-- Does row-level security actually do what the architecture claims?
--
--   psql -v ON_ERROR_STOP=1 -f supabase/verify-rls.sql
--
-- Run after the migrations and `seed.sql`, against a throwaway database. It
-- creates its own fixtures, asserts, and rolls everything back — nothing is
-- left behind and it is safe to run repeatedly.
--
-- WHY THIS EXISTS
--
-- The access rule is enforced in three places (README, "How access control
-- works"), and two of them were covered: TypeScript by unit tests, the API by
-- the end-to-end suite. The database layer — the one that is supposed to hold
-- when the application is wrong — was asserted only in prose. This file turns
-- each of those claims into something that fails loudly.
--
-- Every check raises an exception on failure, so a non-zero exit means a real
-- regression rather than a diff to read.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on

begin;

-- --- Fixtures ---------------------------------------------------------------
--
-- Four members at the four tiers, one researcher, and three opportunities at
-- ranks 0, 20 and 30. Ids are fixed so failures name something recognisable.

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'rls.free@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'rls.weekly@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'rls.detailed@example.test'),
  ('44444444-4444-4444-8444-444444444444', 'rls.premium@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'rls.staff@example.test');

-- Profiles are created by a trigger on `auth.users`, defaulting to an active
-- member. Only the staff fixture needs changing.
--
-- Changing it is blocked by `guard_profile_privilege_changes`, which is the
-- point: privilege escalation through a profile update is exactly what that
-- trigger exists to stop, and writing this file was the first time anything
-- had actually tried it. So the guard is asserted first, then suspended for
-- the fixture, then restored — a harness that quietly disabled it and moved on
-- would be testing a database nobody runs.

do $$
begin
  raise notice 'Privilege-escalation guard';
  begin
    update public.profiles
    set role = 'super_administrator'
    where id = '11111111-1111-4111-8111-111111111111';

    raise exception
      'RLS CHECK FAILED — a role change was accepted without a super '
      'administrator';
  exception
    when insufficient_privilege then
      raise notice '  ok  a role change is refused without a super administrator';
  end;

  begin
    update public.profiles
    set account_status = 'suspended'
    where id = '11111111-1111-4111-8111-111111111111';

    raise exception
      'RLS CHECK FAILED — an account-status change was accepted without a '
      'super administrator';
  exception
    when insufficient_privilege then
      raise notice '  ok  an account-status change is refused likewise';
  end;

  begin
    update public.profiles
    set access_rank_override = 100
    where id = '11111111-1111-4111-8111-111111111111';

    raise exception
      'RLS CHECK FAILED — an access-rank override was accepted without a '
      'super administrator';
  exception
    when insufficient_privilege then
      raise notice '  ok  an access-rank override is refused likewise';
  end;
end;
$$;

alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
update public.profiles set role = 'editor'
where id = '55555555-5555-4555-8555-555555555555';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;

-- A free subscription is created for every new account by a trigger (migration
-- 0004), and `subscriptions.user_id` is unique — one row per member, moved
-- between plans. So these are updates, not inserts. That the insert failed
-- here is itself confirmation the trigger fires.
update public.subscriptions s
set plan_id = p.id,
    status = 'active',
    current_period_end = now() + interval '30 days'
from (values
  ('22222222-2222-4222-8222-222222222222'::uuid, 'weekly'),
  ('33333333-3333-4333-8333-333333333333'::uuid, 'detailed'),
  ('44444444-4444-4444-8444-444444444444'::uuid, 'premium')
) as u(id, code)
join public.subscription_plans p on p.code = u.code
where s.user_id = u.id;

insert into public.opportunities (
  id, title, slug, category, subtype, summary, source_id,
  original_source_url, risk_summary, recommended_next_action,
  county_id, workflow_status, minimum_access_rank, published_at
)
select
  v.id, v.title, v.slug, 'commercial_property', 'tax_sale',
  'Fixture for the row-level security check.',
  (select id from public.sources limit 1),
  'https://example.test/notice',
  'Fixture risk summary for the row-level security check.',
  'Fixture next action for the row-level security check.',
  (select id from public.counties limit 1),
  'published', v.rank, now() - interval '1 day'
from (values
  ('aaaaaaaa-0000-4000-8000-000000000001'::uuid, 'RLS fixture free',     'rls-fixture-free',     0),
  ('aaaaaaaa-0000-4000-8000-000000000002'::uuid, 'RLS fixture detailed', 'rls-fixture-detailed', 20),
  ('aaaaaaaa-0000-4000-8000-000000000003'::uuid, 'RLS fixture premium',  'rls-fixture-premium',  30)
) as v(id, title, slug, rank);

-- A restricted record: withheld from everyone regardless of tier.
insert into public.opportunities (
  id, title, slug, category, subtype, summary, source_id,
  original_source_url, risk_summary, recommended_next_action,
  county_id, workflow_status, minimum_access_rank, published_at,
  is_restricted, restriction_reason
)
select
  'aaaaaaaa-0000-4000-8000-000000000004', 'RLS fixture restricted',
  'rls-fixture-restricted', 'commercial_property', 'tax_sale',
  'Fixture for the restriction check.',
  (select id from public.sources limit 1),
  'https://example.test/notice',
  'Fixture risk summary for the restriction check.',
  'Fixture next action for the restriction check.',
  (select id from public.counties limit 1),
  'published', 0, now() - interval '1 day',
  true, 'Withheld pending a source dispute.';

-- A draft: never visible to a member whatever their tier.
insert into public.opportunities (
  id, title, slug, category, subtype, summary, source_id,
  original_source_url, risk_summary, recommended_next_action,
  county_id, workflow_status, minimum_access_rank
)
select
  'aaaaaaaa-0000-4000-8000-000000000005', 'RLS fixture draft',
  'rls-fixture-draft', 'commercial_property', 'tax_sale',
  'Fixture for the draft-visibility check.',
  (select id from public.sources limit 1),
  'https://example.test/notice',
  'Fixture risk summary for the draft check.',
  'Fixture next action for the draft check.',
  (select id from public.counties limit 1),
  'draft', 0;

-- --- The harness ------------------------------------------------------------

create or replace function pg_temp.visible_as(actor uuid)
returns bigint
language plpgsql
as $$
declare
  seen bigint;
begin
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into seen
  from public.opportunities
  where slug like 'rls-fixture-%';

  perform set_config('role', 'postgres', true);
  return seen;
end;
$$;

create or replace function pg_temp.expect(
  label text,
  actual bigint,
  wanted bigint
)
returns void
language plpgsql
as $$
begin
  if actual is distinct from wanted then
    raise exception 'RLS CHECK FAILED — %: saw %, expected %',
      label, actual, wanted;
  end if;
  raise notice '  ok  % (%)', label, actual;
end;
$$;

-- --- The claims -------------------------------------------------------------

do $$
declare
  anon_rank integer;
begin
  raise notice 'Row-level security';

  -- Free: the rank-0 record only. Not the paid ones, not the restricted one,
  -- not the draft.
  perform pg_temp.expect(
    'a free member sees only the rank-0 record',
    pg_temp.visible_as('11111111-1111-4111-8111-111111111111'), 1);

  -- Weekly is rank 10: still below the rank-20 record.
  perform pg_temp.expect(
    'a weekly member sees only the rank-0 record',
    pg_temp.visible_as('22222222-2222-4222-8222-222222222222'), 1);

  -- Detailed is rank 20: reaches the rank-20 record, not the rank-30 one.
  perform pg_temp.expect(
    'a detailed member reaches rank 20 but not rank 30',
    pg_temp.visible_as('33333333-3333-4333-8333-333333333333'), 2);

  -- Premium is rank 30: all three published, unrestricted records.
  perform pg_temp.expect(
    'a premium member reaches every published tier',
    pg_temp.visible_as('44444444-4444-4444-8444-444444444444'), 3);

  -- Staff see the restricted record and the draft as well: five in total.
  perform pg_temp.expect(
    'staff see restricted records and drafts too',
    pg_temp.visible_as('55555555-5555-4555-8555-555555555555'), 5);

  -- Nobody at all, with no session.
  perform set_config('request.jwt.claim.sub', '', true);
  select public.my_access_rank() into anon_rank;
  if anon_rank is distinct from 0 then
    raise exception 'RLS CHECK FAILED — an anonymous caller has rank %', anon_rank;
  end if;
  raise notice '  ok  an anonymous caller has rank 0';
end;
$$;

-- --- Audit-log privilege ----------------------------------------------------
--
-- `write_audit_log` is SECURITY DEFINER, and PostgreSQL grants EXECUTE to
-- PUBLIC by default. Migration 0017 revokes it and puts a staff check in front
-- of it. If that revoke is ever lost, any authenticated member can forge audit
-- entries — so the absence of the grant is asserted rather than assumed.

do $$
declare
  fn text;
  role_name text;
begin
  raise notice 'Function privileges';

  -- Ask the privilege system, not the ACL string. An earlier version of this
  -- check matched `proacl` for a PUBLIC grant and passed while `authenticated`
  -- held EXECUTE by name — which is precisely the hole migration 0024 closes.
  foreach fn in array array[
    'public.write_audit_log(text, text, uuid, jsonb, jsonb)',
    'public.check_rate_limit(text, integer, integer)',
    'public.prune_rate_limit_counters()',
    'public.effective_access_rank(uuid)',
    'public.subscription_access_rank(uuid)',
    'public.handle_new_auth_user()',
    'public.guard_profile_privilege_changes()',
    'public.record_opportunity_version()',
    'public.audit_opportunity_changes()',
    'public.audit_profile_changes()'
  ]
  loop
    foreach role_name in array array['anon', 'authenticated']
    loop
      if has_function_privilege(role_name, fn, 'EXECUTE') then
        raise exception
          'RLS CHECK FAILED — % is executable by %. PostgREST exposes every '
          'function `authenticated` may execute as an RPC endpoint.',
          fn, role_name;
      end if;
    end loop;
  end loop;
  raise notice '  ok  service-role functions are not reachable by anon or authenticated';

  -- And the ones that must stay reachable, or the product breaks.
  foreach fn in array array[
    'public.log_admin_action(text, text, uuid, jsonb, jsonb)',
    'public.opportunity_facets()',
    'public.my_access_rank()',
    'public.is_staff()'
  ]
  loop
    if not has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'RLS CHECK FAILED — % is not callable by authenticated', fn;
    end if;
  end loop;
  raise notice '  ok  the functions the application calls are still reachable';
end;
$$;

-- --- Constants the TypeScript half mirrors ----------------------------------

do $$
begin
  raise notice 'Shared constants';

  if public.staff_access_rank() <> 100 then
    raise exception 'RLS CHECK FAILED — staff_access_rank is %',
      public.staff_access_rank();
  end if;
  raise notice '  ok  staff_access_rank is 100';

  if public.past_due_grace_period() <> interval '3 days' then
    raise exception 'RLS CHECK FAILED — past_due_grace_period is %',
      public.past_due_grace_period();
  end if;
  raise notice '  ok  past_due_grace_period is 3 days';

  if (select count(*) from public.subscription_plans
      where (code, access_rank) in
        (('free', 0), ('weekly', 10), ('detailed', 20), ('premium', 30))) <> 4
  then
    raise exception
      'RLS CHECK FAILED — the seeded plan ranks do not match ACCESS_RANK';
  end if;
  raise notice '  ok  seeded plan ranks match ACCESS_RANK';
end;
$$;

-- --- Every table is protected ------------------------------------------------

do $$
declare
  unprotected text;
begin
  raise notice 'Coverage';

  select string_agg(c.relname, ', ' order by c.relname) into unprotected
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  if unprotected is not null then
    raise exception
      'RLS CHECK FAILED — tables without row-level security: %', unprotected;
  end if;
  raise notice '  ok  every public table has row-level security enabled';
end;
$$;

rollback;
