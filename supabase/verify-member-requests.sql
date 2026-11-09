\set ON_ERROR_STOP on
begin;
-- Disposable fixtures only, rolled back after testing actual database roles.
insert into auth.users(id,email) values
 ('19191919-1919-4919-8919-191919191911','requests.member@example.test'),
 ('19191919-1919-4919-8919-191919191912','requests.editor@example.test'),
 ('19191919-1919-4919-8919-191919191913','requests.support@example.test');
alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
update public.profiles set role='editor' where id='19191919-1919-4919-8919-191919191912';
update public.profiles set role='support_representative' where id='19191919-1919-4919-8919-191919191913';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;
insert into public.support_tickets(id,user_id,subject,message,updated_at) values
 ('19191919-1919-4919-8919-191919191921','19191919-1919-4919-8919-191919191911','Synthetic support request','Synthetic message only','2026-01-01');
insert into public.sources(id,name,source_type,website_url)
values('19191919-1919-4919-8919-191919191930','Request fixture source','government','https://example.test');
insert into public.opportunities(id,title,slug,category,subtype,summary,source_id,original_source_url,risk_summary,recommended_next_action)
values('19191919-1919-4919-8919-191919191931','Request fixture record','request-fixture-record','business_funding','grant','Synthetic summary','19191919-1919-4919-8919-191919191930','https://example.test/opportunity','Synthetic risk','Check original source');
insert into public.correction_requests(id,submitted_by_user_id,opportunity_id,description,updated_at)
values('19191919-1919-4919-8919-191919191922','19191919-1919-4919-8919-191919191911','19191919-1919-4919-8919-191919191931','Synthetic source discrepancy','2026-01-01');
do $$ begin
 if not exists(select 1 from public.correction_requests where id='19191919-1919-4919-8919-191919191922') then raise exception 'Missing correction fixture'; end if;
 if has_function_privilege('anon','public.review_member_request(text,uuid,timestamptz,text,text)','execute') or has_function_privilege('anon','public.member_request_contacts(text,uuid[])','execute') then raise exception 'Anonymous RPC access'; end if;
end $$;
select set_config('request.jwt.claim.sub','19191919-1919-4919-8919-191919191911',true);
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
set local role authenticated;
do $$ begin
 begin perform public.review_member_request('support','19191919-1919-4919-8919-191919191921','2026-01-01','resolved','Member attempted resolution'); raise exception 'Member wrote review'; exception when insufficient_privilege then null; end;
 begin perform public.member_request_contacts('support',array['19191919-1919-4919-8919-191919191921'::uuid]); raise exception 'Member read contacts'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','19191919-1919-4919-8919-191919191912',true);
select set_config('request.jwt.claims','{"aal":"aal1"}',true);
do $$ begin
 begin perform public.review_member_request('corrections','19191919-1919-4919-8919-191919191922','2026-01-01','accepted','Password-only attempted review'); raise exception 'MFA bypass'; exception when insufficient_privilege then null; end;
 begin perform public.member_request_contacts('corrections',array['19191919-1919-4919-8919-191919191922'::uuid]); raise exception 'MFA contact bypass'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{"aal":"aal2"}',true);
do $$ declare stamp timestamptz; begin
 begin perform public.review_member_request('support','19191919-1919-4919-8919-191919191921','2026-01-01','resolved','Wrong role attempted review'); raise exception 'Editor wrote support'; exception when insufficient_privilege then null; end;
 begin perform public.member_request_contacts('support',array['19191919-1919-4919-8919-191919191921'::uuid]); raise exception 'Editor read support contacts'; exception when insufficient_privilege then null; end;
 begin perform public.review_member_request('corrections','19191919-1919-4919-8919-191919191922','2026-01-01','published','Premature publication attempt'); raise exception 'Skipped acceptance'; exception when invalid_parameter_value then null; end;
 begin perform public.review_member_request('corrections','19191919-1919-4919-8919-191919191922','2026-01-01',null,'Invalid status attempted review'); raise exception 'Null status accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.review_member_request('corrections','19191919-1919-4919-8919-191919191922','2026-01-01','accepted','  short '); raise exception 'Empty note accepted'; exception when invalid_parameter_value then null; end;
 perform public.review_member_request('corrections','19191919-1919-4919-8919-191919191922','2026-01-01','accepted','Source discrepancy verified');
 if not exists(select 1 from public.correction_requests where id='19191919-1919-4919-8919-191919191922' and status='accepted' and reviewed_by='19191919-1919-4919-8919-191919191912' and resolved_at is null) then raise exception 'Acceptance state wrong'; end if;
 begin perform public.review_member_request('corrections','19191919-1919-4919-8919-191919191922','2026-01-01','rejected','Stale reviewer attempted overwrite'); raise exception 'Stale review overwrote acceptance'; exception when serialization_failure then null; end;
 select updated_at into stamp from public.correction_requests where id='19191919-1919-4919-8919-191919191922';
 perform public.review_member_request('corrections','19191919-1919-4919-8919-191919191922',stamp,'published','Corrected source now published');
 if not exists(select 1 from public.correction_requests where id='19191919-1919-4919-8919-191919191922' and status='published' and resolved_at is not null) then raise exception 'Publication state wrong'; end if;
 if (select email from public.member_request_contacts('corrections',array['19191919-1919-4919-8919-191919191922'::uuid])) <> 'requests.member@example.test' then raise exception 'Contact mismatch'; end if;
 if exists(select 1 from public.member_request_contacts('corrections',array['19191919-1919-4919-8919-191919191911'::uuid])) then raise exception 'User IDs accepted as request lookup'; end if;
end $$;
select set_config('request.jwt.claim.sub','19191919-1919-4919-8919-191919191913',true);
do $$ declare stamp timestamptz; begin
 begin perform public.review_member_request('corrections','19191919-1919-4919-8919-191919191922',now(),'accepted','Wrong role attempted correction'); raise exception 'Support wrote correction'; exception when insufficient_privilege then null; end;
 perform public.review_member_request('support','19191919-1919-4919-8919-191919191921','2026-01-01','resolved','Issue resolved with source guidance');
 if not exists(select 1 from public.support_tickets where id='19191919-1919-4919-8919-191919191921' and assigned_to='19191919-1919-4919-8919-191919191913' and resolved_at is not null) then raise exception 'Support resolution state wrong'; end if;
 select updated_at into stamp from public.support_tickets where id='19191919-1919-4919-8919-191919191921';
 perform public.review_member_request('support','19191919-1919-4919-8919-191919191921',stamp,'open','Reopened after new information');
 if exists(select 1 from public.support_tickets where id='19191919-1919-4919-8919-191919191921' and resolved_at is not null) then raise exception 'Reopening retained resolved date'; end if;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.audit_logs where entity_id in ('19191919-1919-4919-8919-191919191921','19191919-1919-4919-8919-191919191922') and action in ('support.reviewed','correction.reviewed')) <> 4 then raise exception 'Missing or duplicated review audit'; end if;
 if not exists(select 1 from public.audit_logs where entity_id='19191919-1919-4919-8919-191919191921' and action='support.reviewed' and actor_user_id='19191919-1919-4919-8919-191919191913') then raise exception 'Audit actor not bound to caller'; end if;
end $$;
-- Force an audit failure and prove the status change rolls back with it.
create function pg_temp.reject_request_audit() returns trigger language plpgsql as $$ begin raise exception 'Synthetic audit failure' using errcode='23514'; end $$;
create trigger reject_request_audit before insert on public.audit_logs for each row execute function pg_temp.reject_request_audit();
set local role authenticated;
do $$ declare stamp timestamptz; begin
 select updated_at into stamp from public.support_tickets where id='19191919-1919-4919-8919-191919191921';
 begin perform public.review_member_request('support','19191919-1919-4919-8919-191919191921',stamp,'closed','Attempt closure with broken audit'); raise exception 'Audit failure ignored'; exception when check_violation then null; end;
 if not exists(select 1 from public.support_tickets where id='19191919-1919-4919-8919-191919191921' and status='open') then raise exception 'Unaudited change committed'; end if;
end $$;
reset role;
drop trigger reject_request_audit on public.audit_logs;
alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
update public.profiles set account_status='suspended' where id='19191919-1919-4919-8919-191919191913';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;
set local role authenticated;
do $$ begin
 begin perform public.member_request_contacts('support',array['19191919-1919-4919-8919-191919191921'::uuid]); raise exception 'Suspended staff accessed contact'; exception when insufficient_privilege then null; end;
 begin perform public.review_member_request('support','19191919-1919-4919-8919-191919191921',now(),'closed','Suspended staff attempted review'); raise exception 'Suspended staff wrote review'; exception when insufficient_privilege then null; end;
 raise notice 'ok  request role and MFA gates, restricted contacts, transitions, stale-write guard and audit atomicity';
end $$;
rollback;

