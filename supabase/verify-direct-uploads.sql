\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('16161616-1616-4616-8616-161616161616','direct-upload@example.test'),
 ('17171717-1717-4717-8717-171717171717','other-upload@example.test');
insert into public.reports(id,title,slug,report_type,status,minimum_access_rank)
values ('18181818-1818-4818-8818-181818181818','Upload fixture','direct-upload-fixture','weekly','draft',20);
insert into public.attachment_uploads(id,uploaded_by,parent_type,parent_id,file_name,mime_type,file_size,minimum_access_rank)
values('19191919-1919-4919-8919-191919191919','16161616-1616-4616-8616-161616161616',
 'report','18181818-1818-4818-8818-181818181818','notice.pdf','application/pdf',8,20);
insert into storage.objects(bucket_id,name)
values('attachment-uploads','19191919-1919-4919-8919-191919191919');
do $$ begin
 if (select public from storage.buckets where id='attachment-uploads') then raise exception 'Staging bucket is public'; end if;
 if has_table_privilege('authenticated','public.attachment_uploads','select') or
    has_function_privilege('authenticated','public.claim_attachment_upload(uuid,uuid,uuid)','execute') or
    has_function_privilege('anon','public.complete_attachment_upload(uuid,uuid,text)','execute') then
   raise exception 'Upload coordination is exposed to clients';
 end if;
 if not has_function_privilege('service_role','public.complete_attachment_upload(uuid,uuid,text)','execute') then
   raise exception 'Service role cannot finalize';
 end if;
 raise notice 'ok  private bucket and restricted coordinator grants';
end $$;
grant usage on schema storage,auth,extensions to authenticated;
grant select on storage.objects to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','16161616-1616-4616-8616-161616161616',true);
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='attachment-uploads') then raise exception 'Member can read unvalidated bytes'; end if;
 begin
   perform 1 from public.attachment_uploads;
   raise exception 'Member can read upload intents';
 exception when insufficient_privilege then null;
 end;
 raise notice 'ok  member cannot read staged bytes or intents';
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
-- Local rollback fixture only: the guard is restored before exercising access.
alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
update public.profiles set role='editor' where id='16161616-1616-4616-8616-161616161616';
alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;
set local role authenticated;
select set_config('request.jwt.claim.sub','16161616-1616-4616-8616-161616161616',true);
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='attachment-uploads') then raise exception 'Editor can read staging without the server'; end if;
 raise notice 'ok  editors cannot directly read staged bytes';
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.claim_attachment_upload(
   '19191919-1919-4919-8919-191919191919','17171717-1717-4717-8717-171717171717',
   '20202020-2020-4020-8020-202020202020')) then raise exception 'Wrong owner claimed'; end if;
 if not exists(select 1 from public.claim_attachment_upload(
   '19191919-1919-4919-8919-191919191919','16161616-1616-4616-8616-161616161616',
   '20202020-2020-4020-8020-202020202020')) then raise exception 'Owner could not claim'; end if;
 if exists(select 1 from public.claim_attachment_upload(
   '19191919-1919-4919-8919-191919191919','16161616-1616-4616-8616-161616161616',
   '21212121-2121-4121-8121-212121212121')) then raise exception 'Concurrent claim won'; end if;
 raise notice 'ok  owner binding and active lease exclusion';
end $$;
update public.attachment_uploads set lease_until=now()-interval '1 minute';
select public.claim_attachment_upload('19191919-1919-4919-8919-191919191919',
 '16161616-1616-4616-8616-161616161616','21212121-2121-4121-8121-212121212121');
do $$ begin
 begin
  perform public.complete_attachment_upload('19191919-1919-4919-8919-191919191919',
   '20202020-2020-4020-8020-202020202020',repeat('a',64));
  raise exception 'Old lease finalized' using errcode='XX001';
 exception when raise_exception then null;
 end;
 begin
  perform public.complete_attachment_upload('19191919-1919-4919-8919-191919191919',
   '21212121-2121-4121-8121-212121212121',null);
  raise exception 'Null checksum accepted' using errcode='XX001';
 exception when raise_exception then null;
 end;
 if exists(select 1 from public.attachments where id='19191919-1919-4919-8919-191919191919') then
  raise exception 'Refused finalize created an attachment'; end if;
 raise notice 'ok  stale lease and invalid checksum refused';
end $$;
select public.complete_attachment_upload('19191919-1919-4919-8919-191919191919',
 '21212121-2121-4121-8121-212121212121',repeat('a',64));
do $$ begin
 if not exists(select 1 from public.attachments where id='19191919-1919-4919-8919-191919191919'
  and uploaded_by='16161616-1616-4616-8616-161616161616' and scan_status='pending'
  and minimum_access_rank=20 and report_id='18181818-1818-4818-8818-181818181818'
  and file_path='reports/18181818-1818-4818-8818-181818181818/19191919-1919-4919-8919-191919191919-notice.pdf') then
  raise exception 'Final attachment lost its quarantine or ownership'; end if;
 if (select status from public.attachment_uploads where id='19191919-1919-4919-8919-191919191919')<>'completed' then
  raise exception 'Finalization not recorded'; end if;
 begin
  perform public.complete_attachment_upload('19191919-1919-4919-8919-191919191919',
   '21212121-2121-4121-8121-212121212121',repeat('a',64));
  raise exception 'Repeat finalization accepted' using errcode='XX001';
 exception when raise_exception then null;
 end;
 raise notice 'ok  finalization is atomic, quarantined and non-duplicating';
end $$;
update public.attachment_uploads set status='waiting',expires_at=now()-interval '1 second';
do $$ begin
 if exists(select 1 from public.claim_attachment_upload(
  '19191919-1919-4919-8919-191919191919','16161616-1616-4616-8616-161616161616',
  '20202020-2020-4020-8020-202020202020')) then raise exception 'Expired upload claimed'; end if;
 raise notice 'ok  expired intents cannot be reclaimed';
end $$;

insert into public.opportunities(id,title,slug,category,subtype,summary,source_id,original_source_url,risk_summary,recommended_next_action)
select '22222222-2222-4222-8222-222222222222','Upload fixture','direct-opportunity-fixture','business_funding','fixture','Fixture',id,'https://example.test','Fixture','Fixture' from public.sources limit 1;
insert into public.attachment_uploads(id,uploaded_by,parent_type,parent_id,file_name,mime_type,file_size,minimum_access_rank)
values('23232323-2323-4323-8323-232323232323','16161616-1616-4616-8616-161616161616',
 'opportunity','22222222-2222-4222-8222-222222222222','notice.pdf','application/pdf',8,20);
select public.claim_attachment_upload('23232323-2323-4323-8323-232323232323',
 '16161616-1616-4616-8616-161616161616','21212121-2121-4121-8121-212121212121');
select public.complete_attachment_upload('23232323-2323-4323-8323-232323232323',
 '21212121-2121-4121-8121-212121212121',repeat('b',64));
do $$ begin
 if not exists(select 1 from public.attachments where id='23232323-2323-4323-8323-232323232323'
   and file_path='opportunities/22222222-2222-4222-8222-222222222222/23232323-2323-4323-8323-232323232323-notice.pdf'
   and opportunity_id='22222222-2222-4222-8222-222222222222' and report_id is null) then
  raise exception 'Opportunity finalization used the wrong object path'; end if;
 raise notice 'ok  opportunity finalization preserves the canonical object path';
end $$;
rollback;
