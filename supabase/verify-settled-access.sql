\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('bbbbbbbb-0000-4000-8000-000000000002','payment.guard@example.test');
create temp table payment_checks(label text, passed boolean not null);
update public.subscriptions set
 plan_id=(select id from public.subscription_plans where access_rank=30 limit 1),
 stripe_subscription_id='sub_disposable',status='active',
 current_period_end=now()+interval '30 days',paid_through_at=null
where user_id='bbbbbbbb-0000-4000-8000-000000000002';
insert into payment_checks values('active without settlement grants no access',
 public.subscription_access_rank('bbbbbbbb-0000-4000-8000-000000000002')=0);
update public.subscriptions set paid_through_at=now()+interval '30 days'
where user_id='bbbbbbbb-0000-4000-8000-000000000002';
insert into payment_checks values('settled active grants paid rank',
 public.subscription_access_rank('bbbbbbbb-0000-4000-8000-000000000002')=30);
update public.subscriptions set status='past_due',paid_through_at=now()-interval '2 days'
where user_id='bbbbbbbb-0000-4000-8000-000000000002';
insert into payment_checks values('renewal retains three day grace',
 public.subscription_access_rank('bbbbbbbb-0000-4000-8000-000000000002')=30);
update public.subscriptions set paid_through_at=now()-interval '4 days'
where user_id='bbbbbbbb-0000-4000-8000-000000000002';
insert into payment_checks values('unpaid new month does not extend grace',
 public.subscription_access_rank('bbbbbbbb-0000-4000-8000-000000000002')=0);
update public.subscriptions set status='canceled',paid_through_at=null
where user_id='bbbbbbbb-0000-4000-8000-000000000002';
insert into payment_checks values('unpaid cancellation grants nothing',
 public.subscription_access_rank('bbbbbbbb-0000-4000-8000-000000000002')=0);
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-4000-8000-000000000002',true);
set local role authenticated;
update public.subscriptions set paid_through_at=now()+interval '1 year'
where user_id='bbbbbbbb-0000-4000-8000-000000000002';
reset role;
insert into payment_checks select 'member cannot fabricate settlement',paid_through_at is null
from public.subscriptions where user_id='bbbbbbbb-0000-4000-8000-000000000002';
table payment_checks;
do $$ begin
 if exists(select 1 from payment_checks where not passed) or (select count(*) from payment_checks)<>6
 then raise exception 'Settled subscription access checks failed'; end if;
 raise notice 'ok  all 6 settled access checks passed';
end $$;
rollback;
