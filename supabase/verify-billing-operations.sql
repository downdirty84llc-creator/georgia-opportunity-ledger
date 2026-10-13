-- Disposable local/CI database only. Every fixture rolls back.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('bbbbbbbb-0000-4000-8000-000000000001','billing.guard@example.test');
create temp table billing_checks(label text, passed boolean not null);
create temp table reserved as select * from public.begin_billing_operation(
 'bbbbbbbb-0000-4000-8000-000000000001','checkout','{"plan":"weekly"}'::jsonb);
insert into billing_checks values
 ('only service can begin billing operations',
  has_function_privilege('service_role','public.begin_billing_operation(uuid,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.begin_billing_operation(uuid,text,jsonb)','execute')
  and not has_function_privilege('anon','public.begin_billing_operation(uuid,text,jsonb)','execute')),
 ('members cannot fabricate provider completion', not has_table_privilege('authenticated','public.billing_operations','insert,update,delete')
  and not has_table_privilege('authenticated','public.account_billing_closures','insert,update,delete'));
do $$
begin
  begin
    perform public.begin_billing_operation('bbbbbbbb-0000-4000-8000-000000000001','checkout','{"plan":"weekly"}');
    raise exception using errcode='ZX001';
  exception when sqlstate 'P0001' then insert into billing_checks values('simultaneous checkout refused',true); end;
  begin
    perform public.begin_billing_operation('bbbbbbbb-0000-4000-8000-000000000001','cancel','{}');
    raise exception using errcode='ZX001';
  exception when sqlstate 'P0001' then insert into billing_checks values('different mutation refused until outcome known',true); end;
end;
$$;
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000001',true);
do $$ begin
  begin
    perform public.request_account_deletion();
    raise exception using errcode='ZX001';
  exception when insufficient_privilege then insert into billing_checks values('direct deletion RPC cannot race checkout',true); end;
end $$;
insert into billing_checks select 'unknown response releases lease but retains operation',
 public.finish_billing_operation(id,lease_token,'pending','{}') from reserved;
create temp table resumed as select * from public.begin_billing_operation(
 'bbbbbbbb-0000-4000-8000-000000000001','checkout','{"plan":"weekly"}'::jsonb);
insert into billing_checks select 'retry keeps Stripe idempotency identity',r.id=o.id and r.lease_token<>o.lease_token from resumed r,reserved o;
insert into billing_checks select 'stale worker cannot mark operation complete',
 not public.finish_billing_operation(id,lease_token,'succeeded','{}') from reserved;
insert into billing_checks select 'current worker can finish', public.finish_billing_operation(id,lease_token,'succeeded','{}') from resumed;
update public.subscriptions set stripe_customer_id='cus_test_only' where user_id='bbbbbbbb-0000-4000-8000-000000000001';
select public.request_account_deletion();
insert into billing_checks select 'direct RPC always queues paid billing cleanup',
 completed_at is null from public.account_billing_closures where user_id='bbbbbbbb-0000-4000-8000-000000000001';
do $$ begin
  begin
    perform public.cancel_account_deletion();
    raise exception using errcode='ZX001';
  exception when insufficient_privilege then insert into billing_checks values('reopening waits for billing cleanup',true); end;
end $$;
create temp table closure_claim as select * from public.claim_account_billing_closure('bbbbbbbb-0000-4000-8000-000000000001');
insert into billing_checks select 'closure worker gets a lease', lease_token is not null from closure_claim;
insert into billing_checks values('second closure worker cannot overlap',
 (public.claim_account_billing_closure('bbbbbbbb-0000-4000-8000-000000000001')).lease_token is null);
alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
alter table public.profiles disable trigger guard_account_billing_transition_trigger;
update public.profiles set deletion_requested_at=clock_timestamp()-interval '721 hours' where id='bbbbbbbb-0000-4000-8000-000000000001';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;
alter table public.profiles enable trigger guard_account_billing_transition_trigger;
do $$ declare requested timestamptz;
begin
  select deletion_requested_at into requested from public.profiles where id='bbbbbbbb-0000-4000-8000-000000000001';
  begin
    perform public.claim_account_for_purge('bbbbbbbb-0000-4000-8000-000000000001',requested);
    raise exception using errcode='ZX001';
  exception when sqlstate 'P0001' then insert into billing_checks values('purge waits for billing cancellation',true); end;
end $$;
update public.account_billing_closures set completed_at=clock_timestamp() where user_id='bbbbbbbb-0000-4000-8000-000000000001';
insert into billing_checks select 'purge proceeds after provider confirms cancellation',
 public.claim_account_for_purge(id,deletion_requested_at) from public.profiles where id='bbbbbbbb-0000-4000-8000-000000000001';
table billing_checks;
do $$ begin
 if exists(select 1 from billing_checks where not passed) or (select count(*) from billing_checks) <> 15 then
   raise exception 'Billing coordination checks failed';
 end if;
 raise notice 'ok  all 15 billing coordination checks passed';
end $$;
rollback;
