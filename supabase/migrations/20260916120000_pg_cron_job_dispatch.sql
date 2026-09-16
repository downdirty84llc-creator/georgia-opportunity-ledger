-- Schedule the background jobs from inside the database.
--
-- Vercel's hobby plan enforces a once-per-day minimum cron cadence and fails
-- the deploy on anything more frequent. Six of the fourteen jobs run every five
-- to thirty minutes, so the platform scheduler cannot express this schedule at
-- all without moving to Pro.
--
-- pg_cron can, at no cost, and it fixes a second problem on the way: a Supabase
-- project with no traffic is paused after roughly a week, which is exactly what
-- happened to this one in September. A database that calls out every five
-- minutes does not idle.
--
-- The endpoint is unchanged. It authorises on the bearer token, not on who is
-- calling, so it does not care whether Vercel Cron, a Netlify function or
-- Postgres made the request.

-- Extensions are created only where they exist. `verify-schema.sh` and the CI
-- migrations job apply this file to a bare PostgreSQL that ships neither
-- pg_cron nor pg_net, and a migration that cannot run from empty is a migration
-- that will fail on the next environment. The functions below are created
-- either way; they resolve `cron.*` and `net.*` at call time, not at creation,
-- so they are simply unusable off Supabase — which is correct, since nothing
-- off Supabase should be dispatching production jobs.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;

  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;

  -- pg_cron's tables must never be reachable through PostgREST. The schema is
  -- not in the exposed list, but revoking is cheap and the consequence of being
  -- wrong is an attacker editing the schedule.
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    revoke all on schema cron from anon, authenticated;
  end if;
end;
$$;

/**
 * Fire one job endpoint.
 *
 * Secrets come from Vault rather than from this file, so the migration is
 * environment-neutral and nothing sensitive is committed. Store them once per
 * environment:
 *
 *   select vault.create_secret('https://gaopportunityledger.com', 'ledger_site_url');
 *   select vault.create_secret('<CRON_SECRET>',                   'ledger_cron_secret');
 */
create or replace function public.dispatch_ledger_job(p_job text)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  base    text;
  secret  text;
  request bigint;
begin
  select decrypted_secret into base
  from vault.decrypted_secrets where name = 'ledger_site_url';

  select decrypted_secret into secret
  from vault.decrypted_secrets where name = 'ledger_cron_secret';

  -- Fail loudly. A scheduled job that quietly does nothing looks exactly like
  -- one that ran and found no work, and this schedule is unattended.
  if base is null or secret is null then
    raise exception
      'dispatch_ledger_job(%): ledger_site_url or ledger_cron_secret is not in Vault',
      p_job
      using errcode = 'no_data_found';
  end if;

  select net.http_post(
    url     := base || '/api/v1/jobs/' || p_job,
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || secret,
                 'Content-Type',  'application/json'
               ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) into request;

  return request;
end;
$$;

revoke all on function public.dispatch_ledger_job(text) from public, anon, authenticated;
grant execute on function public.dispatch_ledger_job(text) to service_role;

/**
 * Create or re-point one schedule. Idempotent: re-running with a different
 * cadence moves the existing job rather than creating a second one that fires
 * alongside it.
 */
create or replace function public.schedule_ledger_job(p_job text, p_schedule text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  job_name text := 'ledger_' || p_job;
begin
  perform cron.unschedule(job_name)
  where exists (select 1 from cron.job where jobname = job_name);

  perform cron.schedule(
    job_name,
    p_schedule,
    format('select public.dispatch_ledger_job(%L);', p_job)
  );
end;
$$;

revoke all on function public.schedule_ledger_job(text, text) from public, anon, authenticated;
grant execute on function public.schedule_ledger_job(text, text) to service_role;

comment on function public.dispatch_ledger_job(text) is
  'Calls /api/v1/jobs/<name> with the Vault-held CRON_SECRET. Service role only.';
comment on function public.schedule_ledger_job(text, text) is
  'Idempotently creates or re-points a pg_cron schedule for one job.';
