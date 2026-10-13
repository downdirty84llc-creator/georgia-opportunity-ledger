\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('99999999-9999-4999-8999-999999999999','export-test@example.test'),
 ('99999999-9999-4999-8999-999999999998','export-free@example.test');
update public.subscriptions set plan_id=(select id from public.subscription_plans where code='premium'),
 status='active',current_period_end=now()+interval '1 month' where user_id='99999999-9999-4999-8999-999999999999';
insert into public.opportunities(id,title,slug,category,subtype,summary,source_id,original_source_url,
 risk_summary,recommended_next_action,county_id,workflow_status,minimum_access_rank,published_at)
select md5('export-test-'||n)::uuid,'Export fixture '||n,'export-test-'||n,'commercial_property','tax_sale','Export fixture',
 (select id from public.sources limit 1),'https://example.test/notice','Fixture risk','Verify with source',
 (select id from public.counties limit 1),'published',30,now()-interval '1 day' from generate_series(1,1105) n;
insert into public.opportunity_industries(opportunity_id,industry_id)
select md5('export-test-1')::uuid,id from public.industries order by id limit 1;
insert into public.export_jobs(id,user_id,filter_configuration) values
 ('eeeeeeee-0000-4000-8000-000000000001','99999999-9999-4999-8999-999999999999','{"q":"Export fixture"}'),
 ('eeeeeeee-0000-4000-8000-000000000002','99999999-9999-4999-8999-999999999999','{}'),
 ('eeeeeeee-0000-4000-8000-000000000003','99999999-9999-4999-8999-999999999998','{}');
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$ begin
 if ok is distinct from true then raise exception 'EXPORT CHECK FAILED: %',label; end if;
 raise notice 'ok  %',label;
end $$;
do $$ declare a public.export_jobs; b public.export_jobs; old_token uuid; payload jsonb; n integer;
begin
 perform pg_temp.expect(not has_function_privilege('authenticated','public.claim_export_job(uuid)','execute')
  and not has_function_privilege('anon','public.export_opportunity_data(uuid,uuid)','execute'), 'worker RPCs are service-only');
 a:=public.claim_export_job('eeeeeeee-0000-4000-8000-000000000003');
 perform pg_temp.expect(a.id is null,'free member cannot generate an export');
 a:=public.claim_export_job('eeeeeeee-0000-4000-8000-000000000001');
 old_token:=a.lease_token;
 b:=public.claim_export_job(a.id);
 perform pg_temp.expect(b.id is null,'a second worker cannot claim a live lease');
 payload:=public.export_opportunity_data(a.id,a.lease_token);
 perform pg_temp.expect(jsonb_array_length(payload->'rows')=1105,'snapshot includes members of pages beyond 1000 rows');
 update public.export_jobs set lease_until=now()-interval '1 second',prepared_csv='same immutable bytes',prepared_access_rank=30,row_count=1105 where id=a.id;
 b:=public.claim_export_job(a.id);
 perform pg_temp.expect(b.lease_token<>old_token and b.prepared_csv='same immutable bytes','reclaimed worker retains prepared bytes with a new token');
 perform pg_temp.expect(not public.finish_export_job(a.id,old_token),'a terminated worker cannot finish after reclaim');
 perform pg_temp.expect(public.finish_export_job(b.id,b.lease_token),'current worker can finish');
 perform pg_temp.expect((select prepared_csv is null from public.export_jobs where id=b.id),'completion removes duplicate CSV bytes from database');
 a:=public.claim_export_job('eeeeeeee-0000-4000-8000-000000000002');
 perform pg_temp.expect(a.file_path<>b.file_path,'jobs created in the same second have different paths');
 update public.export_jobs set filter_configuration=jsonb_build_object('industryIds',jsonb_build_array((select industry_id from public.opportunity_industries where opportunity_id=md5('export-test-1')::uuid))) where id=a.id;
 payload:=public.export_opportunity_data(a.id,a.lease_token);
 perform pg_temp.expect(jsonb_array_length(payload->'rows')=1,'secondary industry filters are enforced');
 update public.opportunities set is_restricted=true,restriction_reason='test' where id=md5('export-test-1')::uuid;
 payload:=public.export_opportunity_data(a.id,a.lease_token);
 perform pg_temp.expect(jsonb_array_length(payload->'rows')=0,'restricted matches never enter the snapshot');
 update public.opportunities set is_restricted=false,restriction_reason=null,minimum_access_rank=100 where id=md5('export-test-1')::uuid;
 payload:=public.export_opportunity_data(a.id,a.lease_token);
 perform pg_temp.expect(jsonb_array_length(payload->'rows')=0,'matching rows above the paid rank stay hidden');
 update public.export_jobs set filter_configuration='{}',opportunity_ids='{}' where id=a.id;
 payload:=public.export_opportunity_data(a.id,a.lease_token);
 perform pg_temp.expect(jsonb_array_length(payload->'rows')=0,'an empty explicit selection is never an unfiltered export');
 update public.export_jobs set prepared_csv='bytes',prepared_access_rank=30 where id=a.id;
 update public.subscriptions set status='expired' where user_id=a.user_id;
 perform pg_temp.expect(not public.finish_export_job(a.id,a.lease_token),'loss of paid access prevents completion');
end $$;
insert into storage.objects(bucket_id,name) select 'exports',file_path from public.export_jobs where file_path is not null;
grant usage on schema storage to authenticated;
grant select on storage.objects to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','99999999-9999-4999-8999-999999999999',true);
do $$ begin
 perform pg_temp.expect(not exists(select 1 from storage.objects where bucket_id='exports'),'downgrade revokes direct Storage downloads');
 perform pg_temp.expect(not exists(select 1 from public.export_jobs),'downgrade revokes prepared CSV and export metadata');
end $$;
reset role;
update public.subscriptions set status='active' where user_id='99999999-9999-4999-8999-999999999999';
set local role authenticated;
do $$ begin
 perform pg_temp.expect((select count(*)=1 from storage.objects where bucket_id='exports'),'only ready files are directly downloadable');
end $$;
reset role;
update public.export_jobs set expires_at=now()-interval '1 second';
set local role authenticated;
do $$ begin
 perform pg_temp.expect(not exists(select 1 from storage.objects where bucket_id='exports'),'expired files are not directly downloadable');
end $$;
reset role;
rollback;
