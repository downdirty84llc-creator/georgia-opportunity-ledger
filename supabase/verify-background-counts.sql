\set ON_ERROR_STOP on
begin;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'BACKGROUND CHECK FAILED: %',label; end if; raise notice 'ok  %',label;
end $$;
insert into auth.users(id,email) values('66666666-1111-4111-8111-111111111111','analytics-fixture@example.test');
update public.profiles set is_sample=true where id='66666666-1111-4111-8111-111111111111';
insert into public.analytics_events(event_name,occurred_at) select 'fixture-event','2000-01-01T12:00:00Z'::timestamptz from generate_series(1,1105);
insert into public.analytics_events(user_id,event_name,occurred_at) values('66666666-1111-4111-8111-111111111111','sample-event','2000-01-01T12:00:00Z');
insert into public.analytics_events(event_name,occurred_at) values('next-day','2000-01-02T00:00:00Z');
insert into public.opportunities(title,slug,category,subtype,summary,source_id,original_source_url,risk_summary,recommended_next_action)
select 'Lifecycle fixture','background-test-fixture','other','fixture','Fixture',(select id from public.sources limit 1),'https://example.test','Fixture','Verify';
do $$ declare result jsonb; opp uuid; status_name public.opportunity_status;
begin
 result:=public.aggregate_analytics_window('2000-01-01T00:00:00Z','2000-01-02T00:00:00Z');
 perform pg_temp.expect((result->>'total')::integer=1105,'counts every event beyond PostgREST page one');
 perform pg_temp.expect((result->'counts'->>'fixture-event')::integer=1105,'retains anonymous traffic');
 perform pg_temp.expect(not (result->'counts' ? 'sample-event'),'sample accounts do not inflate analytics');
 perform pg_temp.expect(not (result->'counts' ? 'next-day'),'calendar-day end is exclusive');
 perform pg_temp.expect(public.aggregate_analytics_window('1999-01-01T00:00:00Z','1999-01-02T00:00:00Z')='{"total":0,"counts":{}}'::jsonb,'empty day returns zero without null counters');
 perform pg_temp.expect(not has_function_privilege('authenticated','public.aggregate_analytics_window(timestamptz,timestamptz)','execute'),'members cannot access internal analytics aggregation');
 select id into opp from public.opportunities order by id limit 1;
 if opp is null then raise exception 'Missing local opportunity fixture'; end if;
 foreach status_name in array array['closed','withdrawn','under_review','information_only']::public.opportunity_status[] loop
  update public.opportunities set status=status_name,closing_date=now()+interval '2 days' where id=opp;
  perform pg_temp.expect((select not is_closing_soon from public.opportunities where id=opp),'trigger respects administrator-controlled status '||status_name::text);
 end loop;
end $$;
rollback;
