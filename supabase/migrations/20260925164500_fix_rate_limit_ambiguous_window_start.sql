-- ---------------------------------------------------------------------------
-- Rate limiting — resolve the ambiguous `window_start`
--
-- `check_rate_limit` declared a PL/pgSQL variable named `window_start`, which
-- is also the name of a column on `rate_limit_counters`. Postgres cannot tell
-- them apart in the ON CONFLICT target, so every call raised
--
--   42702: column reference "window_start" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- The function therefore never worked — not degraded, never once successful.
-- `checkRateLimit` in src/lib/http/rate-limit.ts fails open on limiter faults,
-- by design, so the only symptom was a console line and thirteen limits that
-- silently never applied: login, password reset, registration, export, search
-- and the rest. It surfaced when the first real registration logged it.
--
-- The variable is renamed rather than the column: the column is the stored
-- schema and is referenced by the primary key, the index and the prune job.
-- ---------------------------------------------------------------------------

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
  v_window_start timestamptz;
  current_count integer;
begin
  if p_limit <= 0 or p_window_seconds <= 0 then
    return query select true, 0, now();
    return;
  end if;

  -- Truncate now() to the start of its window.
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_counters (bucket_key, window_start, hit_count)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key, window_start) do update
    set hit_count = public.rate_limit_counters.hit_count + 1
  returning hit_count into current_count;

  return query select
    current_count <= p_limit,
    greatest(p_limit - current_count, 0),
    v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

-- Supabase grants EXECUTE on functions to anon/authenticated by name, and a
-- `create or replace` is enough to re-trigger it. PostgREST exposes anything
-- `authenticated` may execute as POST /rest/v1/rpc/<name>, so this function —
-- which writes to a table with no RLS policies — is revoked again here rather
-- than trusting that the original revoke still holds.
-- See 20260801032955_revoke_privileged_function_grants.sql.
revoke execute on function public.check_rate_limit(text, integer, integer)
  from anon, authenticated;
