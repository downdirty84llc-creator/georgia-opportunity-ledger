\set ON_ERROR_STOP on
begin;
-- Supabase supplies these schema grants; the local stand-ins do not.
grant usage on schema auth, extensions to authenticated;
insert into auth.users(id,email) values
 ('88888888-1111-4111-8111-111111111111','preferences-one@example.test'),
 ('88888888-2222-4222-8222-222222222222','preferences-two@example.test');
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'PREFERENCE CHECK FAILED: %',label; end if;
 raise notice 'ok  %',label;
end $$;
select pg_temp.expect(not has_function_privilege('anon','public.save_email_preferences(boolean,boolean,jsonb)','execute'),'anonymous callers cannot save preferences');
select pg_temp.expect(not has_function_privilege('service_role','public.save_email_preferences(boolean,boolean,jsonb)','execute'),'server credentials cannot bypass the session-owned endpoint');
select pg_temp.expect((select not prosecdef from pg_proc where oid='public.save_email_preferences(boolean,boolean,jsonb)'::regprocedure),'preference RPC runs with caller RLS');

-- Force a database failure after the master switch and first alert write.
create function pg_temp.reject_preference_fixture() returns trigger language plpgsql as $$ begin
 if new.user_id='88888888-1111-4111-8111-111111111111' and new.alert_type='billing' then
   raise exception 'injected storage failure' using errcode='P0001';
 end if;
 return new;
end $$;
create trigger reject_preference_fixture before insert or update on public.alert_preferences
 for each row execute function pg_temp.reject_preference_fixture();

set local role authenticated;
select set_config('request.jwt.claim.sub','88888888-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claim.role','authenticated',true);
select public.save_email_preferences(false,false,'[{"alertType":"weekly_report","enabled":false,"frequency":"weekly","minimumScore":71}]');
select pg_temp.expect((select not email_alerts_enabled and not marketing_email_enabled from public.user_preferences where user_id=auth.uid()),'master opt-outs commit');
select pg_temp.expect((select not enabled and frequency='weekly' and minimum_score=71 from public.alert_preferences where user_id=auth.uid() and alert_type='weekly_report'),'individual choices commit with the master switches');
select public.save_email_preferences(true,false,'[{"alertType":"weekly_report","enabled":true}]');
select pg_temp.expect((select enabled and frequency='weekly' and minimum_score=71 from public.alert_preferences where user_id=auth.uid() and alert_type='weekly_report'),'omitted frequency and score survive an enabled toggle');
select public.save_email_preferences(true,false,'[]');
select pg_temp.expect((select count(*)=1 from public.alert_preferences where user_id=auth.uid()),'empty alert set leaves existing choices alone');

do $$ begin
 begin
  perform public.save_email_preferences(false,true,'[{"alertType":"weekly_report","enabled":false},{"alertType":"billing","enabled":false}]');
  raise exception 'storage failure unexpectedly accepted';
 exception when raise_exception then
  if sqlerrm <> 'injected storage failure' then raise; end if;
 end;
 perform pg_temp.expect((select email_alerts_enabled and not marketing_email_enabled from public.user_preferences where user_id=auth.uid()),'later write failure rolls back both master switches');
 perform pg_temp.expect((select enabled from public.alert_preferences where user_id=auth.uid() and alert_type='weekly_report'),'later write failure also rolls back earlier individual choices');
 begin
  perform public.save_email_preferences(false,true,'[{"alertType":"weekly_report","enabled":false},{"alertType":"weekly_report","enabled":true}]');
  raise exception 'duplicate preference unexpectedly accepted';
 exception when invalid_parameter_value then null; end;
 perform pg_temp.expect((select email_alerts_enabled and not marketing_email_enabled from public.user_preferences where user_id=auth.uid()),'duplicate type cannot partially save master choices');
 begin
  perform public.save_email_preferences(false,true,'[{"alertType":"weekly_report","enabled":false,"minimumScore":101}]');
  raise exception 'invalid score unexpectedly accepted';
 exception when check_violation then null; end;
 perform pg_temp.expect((select email_alerts_enabled and not marketing_email_enabled from public.user_preferences where user_id=auth.uid()),'invalid score rolls back the entire request');
end $$;
select public.save_email_preferences(false,false,'[{"alertType":"high_score","enabled":false,"user_id":"88888888-2222-4222-8222-222222222222"}]');
select pg_temp.expect((select count(*)=1 from public.alert_preferences where user_id=auth.uid() and alert_type='high_score'),'untrusted user ID cannot redirect an individual preference');
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin
  perform public.save_email_preferences(false,false,'[]');
  raise exception 'missing identity unexpectedly accepted';
 exception when insufficient_privilege then null; end;
 raise notice 'ok  session without identity is refused';
end $$;
reset role;
select pg_temp.expect((select email_alerts_enabled and not marketing_email_enabled from public.user_preferences where user_id='88888888-2222-4222-8222-222222222222'),'another member master choices are unchanged');
select pg_temp.expect(not exists(select 1 from public.alert_preferences where user_id='88888888-2222-4222-8222-222222222222'),'another member alert choices are unchanged');
delete from public.user_preferences where user_id='88888888-1111-4111-8111-111111111111';
set local role authenticated;
select set_config('request.jwt.claim.sub','88888888-1111-4111-8111-111111111111',true);
select public.save_email_preferences(false,false,'[]');
select pg_temp.expect((select not email_alerts_enabled from public.user_preferences where user_id=auth.uid()),'missing preference row is created instead of reporting a zero-row update as success');
rollback;
