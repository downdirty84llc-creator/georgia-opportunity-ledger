-- ---------------------------------------------------------------------------
-- 0024 — Take EXECUTE away from the API roles on functions they must not call
--
-- Migration 0017 revoked `write_audit_log` from PUBLIC, which was the right
-- instinct and the wrong grantee. Supabase ships
--
--   alter default privileges in schema public
--     grant execute on functions to anon, authenticated, service_role;
--
-- so every function these migrations create is granted to those roles *by
-- name* at the moment it is created. Revoking from PUBLIC removes a grant that
-- was never the one doing the work; the named grants survive untouched.
--
-- The consequence was not theoretical. PostgREST exposes every function in
-- `public` that `authenticated` may execute as `POST /rest/v1/rpc/<name>`, so
-- any signed-in member could call `write_audit_log` directly and write
-- whatever they liked into the append-only audit trail — the one record that
-- is supposed to survive a compromised account. This was found by running the
-- migrations against a real PostgreSQL instance and asking
-- `has_function_privilege` rather than reading the migration and believing it.
--
-- What stays callable, and why:
--
--   log_admin_action      staff write audit entries through it, from a session
--                         client. It checks `is_staff()` itself, which is the
--                         guard that makes the wrapper safe to expose.
--   search_opportunities  the public search path; it redacts by rank inside.
--   opportunity_facets    filter counts for the search UI, anonymous included.
--   is_staff, has_role, my_access_rank, account_is_active,
--   current_user_role, current_account_status, can_view_opportunity
--                         predicates used inside the policies themselves, and
--                         each answers only about the caller.
-- ---------------------------------------------------------------------------

-- --- Called only by the service role -----------------------------------------
--
-- The application reaches these through `createAdminClient()`, which
-- authenticates as `service_role` and is never used on behalf of a member.

revoke all on function public.write_audit_log(text, text, uuid, jsonb, jsonb)
  from public, anon, authenticated;

revoke all on function public.check_rate_limit(text, integer, integer)
  from public, anon, authenticated;

revoke all on function public.prune_rate_limit_counters()
  from public, anon, authenticated;

-- Both take a user id, so leaving them callable let any member ask about any
-- other member's plan. The policies that need them call them from inside
-- SECURITY DEFINER functions, which run as the owner regardless.
revoke all on function public.effective_access_rank(uuid)
  from public, anon, authenticated;

revoke all on function public.subscription_access_rank(uuid)
  from public, anon, authenticated;

-- --- Trigger functions -------------------------------------------------------
--
-- These return `trigger` and error out if called directly, and PostgREST does
-- not expose them. Revoking anyway costs nothing and removes the question.

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.ensure_free_subscription() from public, anon, authenticated;
revoke all on function public.guard_profile_privilege_changes() from public, anon, authenticated;
revoke all on function public.record_opportunity_version() from public, anon, authenticated;
revoke all on function public.audit_opportunity_changes() from public, anon, authenticated;
revoke all on function public.audit_profile_changes() from public, anon, authenticated;
revoke all on function public.audit_source_deletion() from public, anon, authenticated;
revoke all on function public.audit_correction_publication() from public, anon, authenticated;

-- --- Keep the ones that must stay reachable ---------------------------------
--
-- Stated explicitly rather than left to the default, so that a future change
-- to Supabase's default privileges cannot silently take them away either.

grant execute on function public.log_admin_action(text, text, uuid, jsonb, jsonb)
  to authenticated, service_role;

grant execute on function public.opportunity_facets()
  to anon, authenticated, service_role;
