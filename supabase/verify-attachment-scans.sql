\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
  ('77777777-7777-4777-8777-777777777777','scan-policy@example.test');
insert into public.reports(id,title,slug,report_type,status,minimum_access_rank,published_at)
values ('88888888-8888-4888-8888-888888888888','Scan policy fixture','scan-policy-fixture','weekly','published',0,now());
insert into public.attachments(report_id,file_name,file_path,mime_type,file_size,scan_status,scan_detail)
select '88888888-8888-4888-8888-888888888888', state || '.pdf', 'scan-policy/' || state || '.pdf',
  'application/pdf', 20, state, case when state = 'infected' then 'Test FOUND' end
from unnest(array['clean','skipped','pending','scanning','failed','infected']) as state;
insert into storage.objects(bucket_id,name)
select 'attachments', file_path from public.attachments where file_path like 'scan-policy/%';
-- CI stand-ins do not inherit Supabase's standard Storage grants.
grant usage on schema storage to authenticated;
grant select on storage.objects to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','77777777-7777-4777-8777-777777777777',true);
do $$ begin
  if (select count(*) from public.attachments where file_path like 'scan-policy/%') <> 1 then
    raise exception 'Unscanned or infected attachment metadata became readable';
  end if;
  if (select count(*) from storage.objects where name like 'scan-policy/%') <> 1 then
    raise exception 'Unscanned or infected Storage bytes became readable';
  end if;
  raise notice 'ok  only a clean attachment row and object are readable';
end $$;
reset role;
update public.reports set minimum_access_rank = 30 where slug = 'scan-policy-fixture';
set local role authenticated;
do $$ begin
  if exists(select 1 from public.attachments where file_path like 'scan-policy/%') or
     exists(select 1 from storage.objects where name like 'scan-policy/%') then
    raise exception 'A clean scan bypassed the parent entitlement';
  end if;
  raise notice 'ok  clean scans still require parent access';
end $$;
reset role;
rollback;
