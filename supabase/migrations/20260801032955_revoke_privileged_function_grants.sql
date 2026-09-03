-- Recovered from the live database (project bbgikfblcahhvrpxiqnd), where it had
-- been applied on 2026-08-01 without ever being committed. The SQL below is the
-- statement Supabase recorded in supabase_migrations.schema_migrations,
-- reproduced verbatim so the repository and the live migration history agree.
--
-- What it does: migration 0024 revoked these from `public`, which does not
-- remove the grants Supabase issues to `anon` and `authenticated` by name.
-- PostgREST exposes any function `authenticated` may execute as
-- POST /rest/v1/rpc/<name>, so those named grants were the whole vulnerability.

revoke execute on function public.write_audit_log(text, text, uuid, jsonb, jsonb)
  from anon, authenticated;

revoke execute on function public.check_rate_limit(text, integer, integer)
  from anon, authenticated;

revoke execute on function public.prune_rate_limit_counters()
  from anon, authenticated;

revoke execute on function public.log_admin_action(text, text, uuid, jsonb, jsonb)
  from anon;

revoke execute on function public.effective_access_rank(uuid)
  from anon, authenticated;

revoke execute on function public.subscription_access_rank(uuid)
  from anon, authenticated;
