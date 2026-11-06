\set ON_ERROR_STOP on
begin;
-- Synthetic fixtures, rolled back in the disposable schema test database.
insert into public.sources(id,name,source_type,website_url)
values('99999999-1111-4111-8111-111111111111','Digest fixture source','government','https://example.test');
insert into public.opportunities(id,title,slug,category,subtype,summary,source_id,original_source_url,
  risk_summary,recommended_next_action,workflow_status,published_at,verification_status,minimum_access_rank)
values('99999999-1111-4111-8111-222222222222','Synthetic eligible record','digest-eligible-fixture','business_funding','grant','Fixture summary',
  '99999999-1111-4111-8111-111111111111','https://example.test/opportunity','Fixture risk','Check source','published',now(),'verified',20);
insert into public.opportunities(title,slug,category,subtype,summary,source_id,original_source_url,
  risk_summary,recommended_next_action,workflow_status,published_at,verification_status,is_sample,is_restricted,restriction_reason,date_verified)
select 'Excluded fixture', 'digest-excluded-'||n,'business_funding','grant','Fixture summary',
  '99999999-1111-4111-8111-111111111111','https://example.test/excluded','Fixture risk','Check source',
  case when n=1 then 'draft'::public.workflow_status else 'published'::public.workflow_status end,now(),
  case when n=2 then 'unverified'::public.verification_status else 'verified'::public.verification_status end,
  n=3,n=4,case when n=4 then 'Private fixture' else null end,
  case when n=5 then current_date-31 else current_date end
from generate_series(1,5) n;

do $$ begin
 if has_function_privilege('anon','public.publish_automated_weekly_digest(boolean)','execute')
 or has_function_privilege('authenticated','public.publish_automated_weekly_digest(boolean)','execute') then
   raise exception 'A member can publish automated reports'; end if;
 if not has_function_privilege('service_role','public.publish_automated_weekly_digest(boolean)','execute') then
   raise exception 'Worker cannot publish automated reports'; end if;
 if (select prosecdef from pg_proc where oid='public.publish_automated_weekly_digest(boolean)'::regprocedure) then
   raise exception 'Digest unexpectedly bypasses caller privileges'; end if;
end $$;
set local role service_role;
do $$ declare result jsonb; v_report_id uuid; before_count integer; begin
 select count(*) into before_count from public.reports;
 result:=public.publish_automated_weekly_digest(true);
 if (result->>'opportunities')::integer<>1 or (select count(*) from public.reports)<>before_count then
   raise exception 'Preview wrote data or included ineligible content'; end if;
 result:=public.publish_automated_weekly_digest(false);
 if result->>'created'<>'true' then raise exception 'Digest was not published'; end if;
 v_report_id:=(result->>'id')::uuid;
 if not exists(select 1 from public.reports where id=v_report_id and status='published' and email_distribution_enabled
   and approved_by is null and created_by is null and minimum_access_rank=10) then
   raise exception 'Digest lost delivery, access or automated authorship boundaries'; end if;
 if (select count(*) from public.report_opportunities where report_opportunities.report_id=v_report_id)<>1
 or not exists(select 1 from public.report_opportunities r where r.report_id=v_report_id
   and opportunity_id='99999999-1111-4111-8111-222222222222' and minimum_access_rank=20) then
   raise exception 'Digest included restricted content or downgraded source access'; end if;
 result:=public.publish_automated_weekly_digest(false);
 if result->>'reason'<>'existing_weekly_report' or (result->>'id')::uuid<>v_report_id then
   raise exception 'Digest retry created a duplicate'; end if;
end $$;
reset role;
delete from public.reports where slug like 'weekly-source-digest-%';
alter table public.report_opportunities add constraint synthetic_digest_failure
 check(opportunity_id<>'99999999-1111-4111-8111-222222222222');
set local role service_role;
do $$ begin
 begin
   perform public.publish_automated_weekly_digest(false);
   raise exception 'Synthetic composition error was ignored';
 exception when check_violation then null; end;
 if exists(select 1 from public.reports where slug like 'weekly-source-digest-%') then
   raise exception 'Partial report was published after composition failed'; end if;
end $$;
reset role;
alter table public.report_opportunities drop constraint synthetic_digest_failure;
-- A human editorial draft for the period takes priority over automated output.
insert into public.reports(title,slug,report_type,reporting_period_start,reporting_period_end,status)
select 'Editorial fixture','digest-editorial-fixture','weekly',
 (p->>'period_start')::date,(p->>'period_end')::date,'draft'
from (select public.publish_automated_weekly_digest(true) p) q;
do $$ declare r jsonb; begin
 r:=public.publish_automated_weekly_digest(false);
 if r->>'reason'<>'existing_weekly_report' or r->>'slug'<>'digest-editorial-fixture' then
   raise exception 'Automated digest replaced editorial work'; end if;
end $$;
-- High-rank market values must not be copied into the Weekly report.
update public.sources set automation_allowed=true,scraping_review_status='permitted_with_limits',terms_reviewed_at=now()
 where id='a4000000-0000-4000-8000-00000000000a';
update public.market_indicators set minimum_access_rank=30 where slug='georgia-construction-employment';
insert into public.market_indicator_values(indicator_id,reporting_period_start,reporting_period_end,value,source_url,verified_at,is_sample)
select id,(date_trunc('month',now())-interval '1 month')::date,(date_trunc('month',now())-interval '1 day')::date,
  999.9,'https://data.bls.gov/timeseries/SMS13000002000000001',now(),false
from public.market_indicators where slug='georgia-construction-employment';
do $$ declare r jsonb; begin
 r:=public.publish_automated_weekly_digest(true);
 if r->>'market_commentary' like '%999.9%' then raise exception 'Private market level leaked into Weekly'; end if;
end $$;
update public.market_indicators set minimum_access_rank=10 where slug='georgia-construction-employment';
do $$ declare r jsonb; begin
 r:=public.publish_automated_weekly_digest(true);
 if r->>'market_commentary' not like '%999.9%' then raise exception 'Approved market observation missing'; end if;
end $$;
rollback;
