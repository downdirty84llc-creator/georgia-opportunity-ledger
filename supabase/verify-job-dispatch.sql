\set ON_ERROR_STOP on
begin;
-- Disposable PostgreSQL only. These names deliberately fail if real provider
-- extensions are present. All mocks and fixture data roll back below.
create schema vault;
create table vault.decrypted_secrets(name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('ledger_site_url','https://example.invalid'),('ledger_cron_secret','synthetic-test-secret');
create schema net;
create table net.test_requests(url text);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
returns bigint language plpgsql as $$ begin
  insert into net.test_requests values(url); return 42;
end $$;
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$ begin
  if ok is distinct from true then raise exception 'DISPATCH CHECK FAILED: %',label; end if;
  raise notice 'ok  %',label;
end $$;

insert into auth.users(id,email) values ('90909090-1111-4111-8111-111111111111','job-gate@example.test');
insert into public.reports(id,title,slug,is_sample)
values ('90909090-2222-4222-8222-222222222222','Dispatch fixture','dispatch-fixture',true);

do $$ declare job text; run_id uuid; export_id uuid; outbox_id uuid;
begin
  perform pg_temp.expect(not has_function_privilege('anon','public.ledger_job_needs_dispatch(text,timestamptz)','execute')
    and not has_function_privilege('authenticated','public.ledger_job_needs_dispatch(text,timestamptz)','execute'), 'work gate is not a member RPC');
  perform pg_temp.expect(has_function_privilege('service_role','public.ledger_job_needs_dispatch(text,timestamptz)','execute'), 'service role may inspect work');
  perform pg_temp.expect(public.ledger_job_needs_dispatch('sync-subscriptions'), 'billing reconciliation always dispatches');
  perform pg_temp.expect(public.ledger_job_needs_dispatch('future-job'), 'unknown jobs always dispatch');
  foreach job in array array['process-exports','close-account-billing','deliver-queued-emails','scan-attachments','publish-scheduled'] loop
    perform pg_temp.expect(public.ledger_job_needs_dispatch(job), job || ': missing history requires endpoint probe');
    insert into public.job_runs(job_name,status,finished_at) values(job,'succeeded',now()) returning id into run_id;
    perform pg_temp.expect(not public.ledger_job_needs_dispatch(job), job || ': empty queue avoids endpoint');
    perform pg_temp.expect(public.ledger_job_needs_dispatch(job,now()+interval '25 hours'), job || ': idle endpoint still probes daily');
    update public.job_runs set status='failed' where id=run_id;
    perform pg_temp.expect(public.ledger_job_needs_dispatch(job), job || ': empty queue cannot hide endpoint failure');
    update public.job_runs set status='succeeded' where id=run_id;
    insert into public.job_work_state(job_name,active_run_id) values(job,run_id);
    perform pg_temp.expect(public.ledger_job_needs_dispatch(job), job || ': unfinished lease keeps retrying');
    update public.job_work_state set active_run_id=null,state='{"cursor":"pending"}' where job_name=job;
    perform pg_temp.expect(public.ledger_job_needs_dispatch(job), job || ': checkpoint keeps retrying');
    update public.job_work_state set state='{}' where job_name=job;
    perform pg_temp.expect(public.dispatch_ledger_job(job) is null, job || ': empty dispatch records a skip');
    perform pg_temp.expect(exists(select 1 from public.job_runs where job_name=job and status='skipped'
      and detail->>'dispatch_mechanism'='database_work_gate'), job || ': skip states its actual mechanism');
    perform pg_temp.expect(public.ledger_job_needs_dispatch(job,now()+interval '25 hours'), job || ': database skips cannot postpone daily probe');
  end loop;
  perform pg_temp.expect(not exists(select 1 from net.test_requests), 'empty queues made no HTTP requests');

  insert into public.export_jobs(user_id) values ('90909090-1111-4111-8111-111111111111') returning id into export_id;
  perform pg_temp.expect(public.ledger_job_needs_dispatch('process-exports'), 'queued export dispatches');
  update public.export_jobs set status='processing',lease_until=null where id=export_id;
  perform pg_temp.expect(public.ledger_job_needs_dispatch('process-exports'), 'interrupted export dispatches');
  perform pg_temp.expect(public.dispatch_ledger_job('process-exports')=42, 'eligible queue uses original HTTP path');

  insert into public.account_billing_closures(user_id,requested_at) values ('90909090-1111-4111-8111-111111111111',now());
  perform pg_temp.expect(public.ledger_job_needs_dispatch('close-account-billing'), 'unfinished billing closure dispatches');

  outbox_id:=public.enqueue_notification_email('90909090-1111-4111-8111-111111111111',
    '[{"dedupe_key":"job-gate","notification_type":"report_published","title":"Fixture","message":"Fixture"}]',
    '{"provider":"console","recipient":"job-gate@example.test"}',0,'weekly_report','{}',null);
  perform pg_temp.expect(public.ledger_job_needs_dispatch('deliver-queued-emails'), 'queued email dispatches');
  update public.email_outbox set state='needs_review' where id=outbox_id;
  perform pg_temp.expect(public.ledger_job_needs_dispatch('deliver-queued-emails'), 'uncertain delivery remains visible to worker');
  update public.email_outbox set state='sent' where id=outbox_id;
  update public.reports set email_queued_at=now() where id='90909090-2222-4222-8222-222222222222';
  perform pg_temp.expect(public.ledger_job_needs_dispatch('deliver-queued-emails'), 'distribution finalization dispatches even with drained outbox');

  insert into public.attachment_uploads(id,uploaded_by,parent_type,parent_id,file_name,mime_type,file_size,minimum_access_rank)
    values(extensions.gen_random_uuid(),'90909090-1111-4111-8111-111111111111','report','90909090-2222-4222-8222-222222222222','fixture.pdf','application/pdf',8,0);
  perform pg_temp.expect(public.ledger_job_needs_dispatch('scan-attachments'), 'upload cleanup dispatches before an attachment exists');
  update public.reports set status='scheduled',scheduled_at=now()+interval '1 hour' where id='90909090-2222-4222-8222-222222222222';
  perform pg_temp.expect(public.ledger_job_needs_dispatch('publish-scheduled'), 'future scheduled report conservatively dispatches');

  delete from vault.decrypted_secrets where name='ledger_cron_secret';
  begin
    perform public.dispatch_ledger_job('scan-attachments');
    raise exception 'Missing Vault configuration was hidden';
  exception when no_data_found then null; end;
  raise notice 'ok  missing Vault secret still fails loudly';
end $$;

-- A predicate regression falls back to the unchanged HTTP path.
create or replace function public.ledger_job_needs_dispatch(p_job text,p_now timestamptz default now())
returns boolean language plpgsql stable as $$ begin raise exception 'Synthetic predicate failure'; end $$;
insert into vault.decrypted_secrets values ('ledger_cron_secret','synthetic-test-secret');
select pg_temp.expect(public.dispatch_ledger_job('process-exports')=42,'broken work gate dispatches rather than dropping a job');
rollback;
