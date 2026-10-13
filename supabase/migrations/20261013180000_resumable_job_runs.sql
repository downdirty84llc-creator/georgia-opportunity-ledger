-- One live worker per job, with durable checkpoints and recovery after a killed
-- serverless invocation. Completion/checkpoint writes are fenced by the run ID.
alter table public.job_runs add column lease_until timestamptz;
create table public.job_work_state (
  job_name text primary key,
  active_run_id uuid,
  state jsonb not null default '{}'::jsonb
);
alter table public.job_work_state enable row level security;
revoke all on public.job_work_state from public,anon,authenticated;
grant all on public.job_work_state to service_role;

create function public.claim_job_run(p_name text,p_key text,p_now timestamptz)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare work public.job_work_state; run public.job_runs;
begin
  insert into public.job_work_state(job_name) values(p_name) on conflict do nothing;
  select * into work from public.job_work_state where job_name=p_name for update;
  if exists(select 1 from public.job_runs where job_name=p_name and status='running'
    and coalesce(lease_until,started_at+interval '2 minutes')>clock_timestamp()) then return null; end if;
  update public.job_runs set status='failed',idempotency_key=null,finished_at=clock_timestamp(),
    error_message='Worker lease expired before completion; progress retained for retry.',records_failed=greatest(1,records_failed)
    where job_name=p_name and status='running';
  if p_key is not null and exists(select 1 from public.job_runs where job_name=p_name and idempotency_key=p_key) then return null; end if;
  insert into public.job_runs(job_name,idempotency_key,status,started_at,lease_until)
    values(p_name,p_key,'running',p_now,clock_timestamp()+interval '2 minutes') returning * into run;
  update public.job_work_state set active_run_id=run.id where job_name=p_name;
  return jsonb_build_object('id',run.id,'state',work.state);
end $$;

create function public.checkpoint_job_run(p_id uuid,p_state jsonb)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare job text; work public.job_work_state;
begin
  select job_name into job from public.job_runs where id=p_id;
  select * into work from public.job_work_state where job_name=job for update;
  if work.active_run_id is distinct from p_id or not exists(select 1 from public.job_runs where id=p_id and status='running' and lease_until>clock_timestamp()) then return false; end if;
  update public.job_work_state set state=p_state where job_name=job;
  return true;
end $$;

create function public.finish_job_run(p_id uuid,p_result jsonb)
returns boolean language plpgsql security definer set search_path=public,extensions as $$
declare job text; work public.job_work_state;
begin
  select job_name into job from public.job_runs where id=p_id;
  select * into work from public.job_work_state where job_name=job for update;
  if work.active_run_id is distinct from p_id or not exists(select 1 from public.job_runs where id=p_id and status='running' and lease_until>clock_timestamp()) then return false; end if;
  if p_result->>'status' not in ('failed','skipped','succeeded') then raise exception 'Invalid job result'; end if;
  update public.job_runs set status=(p_result->>'status')::public.job_status,
    idempotency_key=case when p_result->>'status'='failed' then null else idempotency_key end,
    finished_at=clock_timestamp(),lease_until=null,
    records_processed=coalesce((p_result->>'records_processed')::integer,0),
    records_failed=coalesce((p_result->>'records_failed')::integer,0),
    error_message=p_result->>'error_message',detail=coalesce(p_result->'detail','{}'::jsonb)
    where id=p_id;
  update public.job_work_state set active_run_id=null where job_name=job;
  return true;
end $$;
revoke all on function public.claim_job_run(text,text,timestamptz),public.checkpoint_job_run(uuid,jsonb),public.finish_job_run(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_job_run(text,text,timestamptz),public.checkpoint_job_run(uuid,jsonb),public.finish_job_run(uuid,jsonb) to service_role;
notify pgrst,'reload schema';
