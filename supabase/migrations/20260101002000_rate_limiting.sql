-- ---------------------------------------------------------------------------
-- 0020 — Rate limiting (spec 20)
--
-- The application runs on serverless functions, so an in-process counter would
-- be per-instance and effectively no limit at all. The counter lives in
-- Postgres instead: one row per key per window, incremented atomically.
--
-- Windows are fixed rather than sliding. A fixed window can admit up to 2×
-- the limit across a boundary, which is an acceptable trade for a single
-- indexed upsert per request; the limits below are set with that in mind.
-- ---------------------------------------------------------------------------

create table public.rate_limit_counters (
  bucket_key text not null,
  window_start timestamptz not null,
  hit_count integer not null default 0,
  primary key (bucket_key, window_start)
);

alter table public.rate_limit_counters enable row level security;
-- No policies: reachable only through the SECURITY DEFINER function below and
-- by the service role.

create index rate_limit_counters_window_idx
  on public.rate_limit_counters (window_start);

create or replace function public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  window_start timestamptz;
  current_count integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    return query select true, 0, now();
    return;
  end if;

  -- Truncate now() to the start of its window.
  window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_counters (bucket_key, window_start, hit_count)
  values (p_key, window_start, 1)
  on conflict (bucket_key, window_start) do update
    set hit_count = public.rate_limit_counters.hit_count + 1
  returning hit_count into current_count;

  return query select
    current_count <= p_limit,
    greatest(p_limit - current_count, 0),
    window_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public;
grant execute on function public.check_rate_limit(text, integer, integer)
  to service_role;

-- Housekeeping: the daily job calls this to drop windows nobody will read.
create or replace function public.prune_rate_limit_counters()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  removed integer;
begin
  delete from public.rate_limit_counters
  where window_start < now() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$$;
