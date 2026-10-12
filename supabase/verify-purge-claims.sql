-- Local/CI only. All fixtures and mutations roll back; never run in production.
\set ON_ERROR_STOP on
begin;
insert into auth.users (id, email) values
  ('eeeeeeee-0000-4000-8000-000000000001', 'purge.due@example.test'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'purge.current@example.test'),
  ('eeeeeeee-0000-4000-8000-000000000003', 'purge.admin@example.test');
alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
update public.profiles set account_status = 'closed',
  deletion_requested_at = now() - interval '720 hours'
where id = 'eeeeeeee-0000-4000-8000-000000000001';
update public.profiles set account_status = 'closed',
  deletion_requested_at = now() - interval '24 hours'
where id = 'eeeeeeee-0000-4000-8000-000000000002';
update public.profiles set role = 'super_administrator'
where id = 'eeeeeeee-0000-4000-8000-000000000003';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;

create temp table purge_checks (label text, passed boolean not null);
grant all on purge_checks to authenticated;
create function pg_temp.expect_purge_refused(label text, statement text)
returns void language plpgsql as $$
declare refused boolean := false;
begin
  begin
    execute statement;
    raise exception using errcode = 'ZX001', message = 'unexpectedly allowed';
  exception
    when insufficient_privilege then refused := true;
    when sqlstate 'ZX001' then null;
  end;
  insert into purge_checks values (label, refused);
end;
$$;

insert into purge_checks values
  ('claim RPC is service-only',
    has_function_privilege('service_role', 'public.claim_account_for_purge(uuid,timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.claim_account_for_purge(uuid,timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.claim_account_for_purge(uuid,timestamptz)', 'execute')),
  ('claims cannot be read or changed through the table API',
    not has_table_privilege('authenticated', 'public.account_purge_claims', 'select,insert,update,delete')
    and not has_table_privilege('anon', 'public.account_purge_claims', 'select,insert,update,delete')
    and not has_table_privilege('service_role', 'public.account_purge_claims', 'insert,update,delete')),
  ('current request cannot be claimed',
    not public.claim_account_for_purge('eeeeeeee-0000-4000-8000-000000000002', now() - interval '24 hours')),
  ('stale request date cannot be claimed',
    not public.claim_account_for_purge('eeeeeeee-0000-4000-8000-000000000001', now() - interval '721 hours')),
  ('missing request date cannot be claimed',
    not public.claim_account_for_purge('eeeeeeee-0000-4000-8000-000000000001', null)),
  ('missing profile cannot be claimed',
    not public.claim_account_for_purge('eeeeeeee-0000-4000-8000-000000000099', now() - interval '720 hours')),
  ('elapsed boundary can be claimed',
    public.claim_account_for_purge('eeeeeeee-0000-4000-8000-000000000001', now() - interval '720 hours')),
  ('provider failure can retry the same claim',
    public.claim_account_for_purge('eeeeeeee-0000-4000-8000-000000000001', now() - interval '720 hours'));
insert into purge_checks select 'retry preserves exactly one durable claim', count(*) = 1
from public.account_purge_claims where user_id = 'eeeeeeee-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-0000-4000-8000-000000000003', true);
select pg_temp.expect_purge_refused('staff cannot reopen a claimed account',
  $$update public.profiles set account_status = 'active', deletion_requested_at = null
    where id = 'eeeeeeee-0000-4000-8000-000000000001'$$);
select pg_temp.expect_purge_refused('staff cannot reschedule a claimed account',
  $$update public.profiles set deletion_requested_at = now()
    where id = 'eeeeeeee-0000-4000-8000-000000000001'$$);
select pg_temp.expect_purge_refused('member cannot call the claim RPC',
  $$select public.claim_account_for_purge('eeeeeeee-0000-4000-8000-000000000001', now())$$);
select pg_temp.expect_purge_refused('member cannot release a claim',
  $$delete from public.account_purge_claims where user_id = 'eeeeeeee-0000-4000-8000-000000000001'$$);

-- A staff reversal before a claim is allowed and must invalidate the candidate.
update public.profiles set account_status = 'active',
  deletion_requested_at = now() - interval '721 hours'
where id = 'eeeeeeee-0000-4000-8000-000000000002';
reset role;
insert into purge_checks values ('active profile cannot be claimed',
  not public.claim_account_for_purge('eeeeeeee-0000-4000-8000-000000000002', now() - interval '721 hours'));
update public.profiles set account_status = 'suspended'
where id = 'eeeeeeee-0000-4000-8000-000000000002';
insert into purge_checks values ('suspended profile cannot be claimed',
  not public.claim_account_for_purge('eeeeeeee-0000-4000-8000-000000000002', now() - interval '721 hours'));

-- Local Auth stand-in: verify the claim's FK does not obstruct the existing
-- auth -> profile cascade and leaves no claim record behind after deletion.
delete from auth.users where id = 'eeeeeeee-0000-4000-8000-000000000001';
insert into purge_checks values ('Auth cascade removes the profile and claim',
  not exists(select 1 from public.profiles where id = 'eeeeeeee-0000-4000-8000-000000000001')
  and not exists(select 1 from public.account_purge_claims where user_id = 'eeeeeeee-0000-4000-8000-000000000001'));

table purge_checks;
do $$
declare failures text;
begin
  select string_agg(label, ', ') into failures from purge_checks where not passed;
  if failures is not null then raise exception 'PURGE CHECK FAILED: %', failures; end if;
  raise notice '  ok  all 16 account purge claim checks passed';
end;
$$;
rollback;
