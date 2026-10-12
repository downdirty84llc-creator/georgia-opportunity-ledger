-- Local/CI only: rollback-only fixtures, never run against production.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, email) values
  ('dddddddd-0000-4000-8000-000000000001', 'deletion.current@example.test'),
  ('dddddddd-0000-4000-8000-000000000002', 'deletion.expired@example.test'),
  ('dddddddd-0000-4000-8000-000000000003', 'deletion.active@example.test'),
  ('dddddddd-0000-4000-8000-000000000004', 'deletion.suspended@example.test');

alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
update public.profiles set account_status = 'closed',
  deletion_requested_at = now() - interval '24 hours'
where id = 'dddddddd-0000-4000-8000-000000000001';
update public.profiles set account_status = 'closed',
  deletion_requested_at = now() - interval '720 hours'
where id = 'dddddddd-0000-4000-8000-000000000002';
update public.profiles set account_status = 'suspended',
  deletion_requested_at = now() - interval '24 hours'
where id = 'dddddddd-0000-4000-8000-000000000004';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;

create temp table deletion_checks (label text, passed boolean);
grant all on deletion_checks to authenticated;

create function pg_temp.expect_refused(label text, statement text)
returns void language plpgsql as $$
declare refused boolean := false;
begin
  begin
    execute statement;
    -- Roll back an unexpectedly accepted mutation before the next check.
    raise exception using errcode = 'ZX001', message = 'unexpectedly allowed';
  exception
    when insufficient_privilege or no_data_found then refused := true;
    when sqlstate 'ZX001' then null;
  end;
  insert into deletion_checks values (label, refused);
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000002', true);
select pg_temp.expect_refused('expired cancellation RPC',
  'select public.cancel_account_deletion()');
select pg_temp.expect_refused('expired direct reopening',
  $$update public.profiles set account_status = 'active', deletion_requested_at = null
    where id = 'dddddddd-0000-4000-8000-000000000002'$$);
select pg_temp.expect_refused('moving an expired deletion date',
  $$update public.profiles set deletion_requested_at = now()
    where id = 'dddddddd-0000-4000-8000-000000000002'$$);
select pg_temp.expect_refused('clearing the date without reopening',
  $$update public.profiles set deletion_requested_at = null
    where id = 'dddddddd-0000-4000-8000-000000000002'$$);

select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000004', true);
select pg_temp.expect_refused('suspended account cancellation',
  'select public.cancel_account_deletion()');

select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000003', true);
select pg_temp.expect_refused('date change on an active account',
  $$update public.profiles set deletion_requested_at = now()
    where id = 'dddddddd-0000-4000-8000-000000000003'$$);
select pg_temp.expect_refused('cancellation without a request',
  'select public.cancel_account_deletion()');

-- Direct writes still pass through the trigger; the caller cannot backdate a
-- new request and cause immediate irreversible cleanup.
update public.profiles set account_status = 'closed',
  deletion_requested_at = now() - interval '100 days'
where id = 'dddddddd-0000-4000-8000-000000000003';
insert into deletion_checks
select 'closure date is assigned by the database',
  deletion_requested_at >= transaction_timestamp()
from public.profiles where id = 'dddddddd-0000-4000-8000-000000000003';

select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true);
select public.cancel_account_deletion();
insert into deletion_checks
select 'current cancellation reopens and clears the date',
  account_status = 'active' and deletion_requested_at is null
from public.profiles where id = 'dddddddd-0000-4000-8000-000000000001';
select public.request_account_deletion();
insert into deletion_checks
select 'request RPC closes with a current timestamp',
  account_status = 'closed' and deletion_requested_at >= transaction_timestamp()
from public.profiles where id = 'dddddddd-0000-4000-8000-000000000001';
select pg_temp.expect_refused('a duplicate request cannot extend the window',
  'select public.request_account_deletion()');

select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_refused('cancellation needs an authenticated identity',
  'select public.cancel_account_deletion()');
reset role;

insert into deletion_checks values (
  'purge selection includes the elapsed grace boundary',
  exists(select 1 from public.accounts_due_for_purge(30)
    where id = 'dddddddd-0000-4000-8000-000000000002')
);
insert into deletion_checks values (
  'purge selection excludes current and suspended accounts',
  not exists(select 1 from public.accounts_due_for_purge(30)
    where id in ('dddddddd-0000-4000-8000-000000000001',
                 'dddddddd-0000-4000-8000-000000000003',
                 'dddddddd-0000-4000-8000-000000000004'))
);

insert into deletion_checks
select 'purge cannot shorten the window: ' || coalesce(days::text, 'null'),
  not exists(select 1 from public.accounts_due_for_purge(days)
    where id = 'dddddddd-0000-4000-8000-000000000003')
from (values (0), (-1), (null::integer)) as cases(days);

table deletion_checks;
do $$
declare failures text;
begin
  select string_agg(label, ', ') into failures from deletion_checks where not passed;
  if failures is not null then
    raise exception 'DELETION CHECK FAILED: %', failures;
  end if;
  raise notice '  ok  all 17 account deletion checks passed';
end;
$$;
rollback;
