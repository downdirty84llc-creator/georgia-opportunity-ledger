-- Keep queue polling at its current cadence without starting an HTTP function
-- when these five queues are empty. Unknown jobs always dispatch. A failed,
-- unfinished or stale endpoint run also dispatches, even with an empty queue.
-- A real endpoint probe is required at least daily; database skips are recorded
-- explicitly and never count as those probes.
create function public.ledger_job_needs_dispatch(p_job text, p_now timestamptz default now())
returns boolean
language plpgsql stable security invoker
set search_path = public, extensions
as $$
declare last_run public.job_runs;
begin
  if p_job not in ('process-exports', 'close-account-billing', 'deliver-queued-emails',
                   'scan-attachments', 'publish-scheduled') then
    return true;
  end if;

  select * into last_run from public.job_runs
  where job_name = p_job
    and detail->>'dispatch_mechanism' is distinct from 'database_work_gate'
  order by started_at desc, id desc limit 1;
  if not found or last_run.status not in ('succeeded', 'skipped')
     or last_run.finished_at is null
     or last_run.finished_at < p_now - interval '24 hours' then
    return true;
  end if;
  if exists (select 1 from public.job_work_state where job_name = p_job
             and (active_run_id is not null or state <> '{}'::jsonb)) then
    return true;
  end if;

  case p_job
    when 'process-exports' then
      return exists (select 1 from public.export_jobs where status in ('queued', 'processing'));
    when 'close-account-billing' then
      return exists (select 1 from public.account_billing_closures where completed_at is null);
    when 'deliver-queued-emails' then
      return exists (select 1 from public.email_outbox where state in ('queued', 'sending', 'needs_review'))
          or exists (select 1 from public.reports where email_queued_at is not null and distributed_at is null);
    when 'scan-attachments' then
      -- Include every upload state: cleanup and provider recovery also run here.
      return exists (select 1 from public.attachments)
          or exists (select 1 from public.attachment_uploads);
    when 'publish-scheduled' then
      return exists (select 1 from public.opportunities where workflow_status = 'scheduled')
          or exists (select 1 from public.reports where status = 'scheduled');
    else return true;
  end case;
end;
$$;
revoke all on function public.ledger_job_needs_dispatch(text,timestamptz) from public, anon, authenticated;
grant execute on function public.ledger_job_needs_dispatch(text,timestamptz) to service_role;

create or replace function public.dispatch_ledger_job(p_job text)
returns bigint language plpgsql security definer
set search_path = public, extensions, vault
as $$
declare
  base text;
  secret text;
  request bigint;
  should_dispatch boolean := true;
begin
  select decrypted_secret into base from vault.decrypted_secrets where name = 'ledger_site_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'ledger_cron_secret';
  if base is null or secret is null then
    raise exception 'dispatch_ledger_job(%): ledger_site_url or ledger_cron_secret is not in Vault', p_job
      using errcode = 'no_data_found';
  end if;

  begin
    should_dispatch := public.ledger_job_needs_dispatch(p_job);
  exception when others then
    -- A broken optimization must not suppress the original worker path.
    raise warning 'Work gate failed for %, dispatching normally: %', p_job, sqlerrm;
    should_dispatch := true;
  end;
  if should_dispatch is false then
    insert into public.job_runs(job_name,status,finished_at,detail)
    values (p_job,'skipped',clock_timestamp(),jsonb_build_object(
      'reason','no_eligible_work','dispatch_mechanism','database_work_gate'));
    return null;
  end if;

  select net.http_post(
    url := base || '/api/v1/jobs/' || p_job,
    headers := jsonb_build_object('Authorization','Bearer ' || secret,'Content-Type','application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request;
  return request;
end;
$$;
revoke all on function public.dispatch_ledger_job(text) from public, anon, authenticated;
grant execute on function public.dispatch_ledger_job(text) to service_role;
