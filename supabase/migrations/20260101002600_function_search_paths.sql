-- ---------------------------------------------------------------------------
-- 0026 — Pin `search_path` on the functions that were missing it
--
-- Found by Supabase's database linter against the deployed project
-- (`function_search_path_mutable`). Every SECURITY DEFINER function in this
-- schema already pins its search path; these thirteen are SECURITY INVOKER and
-- were left to inherit the caller's, which is why they were missed.
--
-- Lower severity than the equivalent on a definer function, but not nothing.
-- Several are trigger functions that run on writes a member initiates, and an
-- unqualified reference inside one resolves against whatever `search_path` the
-- session happens to carry. A schema earlier in that path containing a
-- same-named function or operator changes what the trigger does. Pinning it
-- removes the question rather than reasoning about each body in turn.
--
-- `alter function` rather than a body rewrite: the definitions are unchanged
-- and rewriting thirteen of them would bury that fact in noise.
-- ---------------------------------------------------------------------------

alter function public.apply_source_check() set search_path = public, extensions;
alter function public.attach_updated_at(target regclass) set search_path = public, extensions;
alter function public.build_opportunity_search_vector(target_id uuid) set search_path = public, extensions;
alter function public.closing_soon_window() set search_path = public, extensions;
alter function public.derive_indicator_movement() set search_path = public, extensions;
alter function public.maintain_opportunity_lifecycle() set search_path = public, extensions;
alter function public.opportunity_change_is_material(old_row opportunities, new_row opportunities) set search_path = public, extensions;
alter function public.past_due_grace_period() set search_path = public, extensions;
alter function public.refresh_opportunity_search_vector() set search_path = public, extensions;
alter function public.reverification_interval() set search_path = public, extensions;
alter function public.set_updated_at() set search_path = public, extensions;
alter function public.slugify(input text) set search_path = public, extensions;
alter function public.staff_access_rank() set search_path = public, extensions;

-- --- Two linter findings we accept, recorded so nobody re-litigates them ------
--
-- `security_definer_view` on opportunity_previews, market_indicator_previews,
-- report_previews and public_sources is deliberate and is the reason those
-- views exist. Row-level security is row-level; showing a signed-out visitor
-- that a Premium record *exists* — the entire upgrade prompt — cannot be done
-- by relaxing the opportunities policy without handing over the whole row.
-- Running the view as its definer over a narrow column list is the trade:
-- nothing the member is buying is in the projection, and the `where` clause
-- (published, not restricted, published_at <= now()) is the only thing
-- standing in for RLS, which is why it is asserted rather than assumed.
--
-- `rls_enabled_no_policy` on rate_limit_counters is also deliberate. RLS on
-- with no policy denies everyone; the table is written only by the service
-- role, which bypasses RLS. Adding a policy would widen access, not narrow it.
comment on table public.rate_limit_counters is
  'Row-level security is enabled with no policy on purpose: that denies every '
  'API role. Only the service role touches this table, and it bypasses RLS.';
