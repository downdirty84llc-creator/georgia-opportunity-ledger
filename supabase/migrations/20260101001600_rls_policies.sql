-- ---------------------------------------------------------------------------
-- 0016 — Row-level security (spec 3.2, 9, 20)
--
-- Default posture: deny. Every table below has RLS enabled, and anything not
-- granted by an explicit policy is unreachable with an anon or authenticated
-- key. Background jobs run with the service-role key, which bypasses RLS by
-- design; those paths are guarded by CRON_SECRET at the HTTP edge instead.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_preferences enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.billing_events enable row level security;
alter table public.states enable row level security;
alter table public.counties enable row level security;
alter table public.cities enable row level security;
alter table public.sources enable row level security;
alter table public.source_checks enable row level security;
alter table public.industries enable row level security;
alter table public.opportunities enable row level security;
alter table public.opportunity_score_components enable row level security;
alter table public.opportunity_versions enable row level security;
alter table public.opportunity_sources enable row level security;
alter table public.opportunity_industries enable row level security;
alter table public.property_details enable row level security;
alter table public.funding_details enable row level security;
alter table public.market_indicators enable row level security;
alter table public.market_indicator_values enable row level security;
alter table public.saved_opportunities enable row level security;
alter table public.saved_searches enable row level security;
alter table public.alert_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.reports enable row level security;
alter table public.report_sections enable row level security;
alter table public.report_opportunities enable row level security;
alter table public.attachments enable row level security;
alter table public.export_jobs enable row level security;
alter table public.support_tickets enable row level security;
alter table public.correction_requests enable row level security;
alter table public.audit_logs enable row level security;
alter table public.job_runs enable row level security;
alter table public.analytics_events enable row level security;

-- --- Profiles ---------------------------------------------------------------

create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

create policy profiles_select_staff on public.profiles
  for select using (
    public.has_role('support_representative', 'billing_manager',
                    'super_administrator')
  );

create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy profiles_update_super_admin on public.profiles
  for update using (public.has_role('super_administrator'))
  with check (public.has_role('super_administrator'));

-- Members may only ever hold the 'member' role, and may not lift their own
-- account out of suspension or grant themselves an access override. RLS cannot
-- express column-level rules, so this is a trigger.
create or replace function public.guard_profile_privilege_changes()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if public.has_role('super_administrator') then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'Role changes require a super administrator'
      using errcode = 'insufficient_privilege';
  end if;

  if new.account_status is distinct from old.account_status then
    raise exception 'Account status changes require a super administrator'
      using errcode = 'insufficient_privilege';
  end if;

  if new.access_rank_override is distinct from old.access_rank_override
     or new.access_rank_override_expires_at
        is distinct from old.access_rank_override_expires_at then
    raise exception 'Access overrides require a super administrator'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger guard_profile_privilege_changes_trigger
  before update on public.profiles
  for each row execute function public.guard_profile_privilege_changes();

-- --- Preferences ------------------------------------------------------------

create policy user_preferences_own on public.user_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy user_preferences_support_read on public.user_preferences
  for select using (
    public.has_role('support_representative', 'super_administrator')
  );

-- --- Billing ----------------------------------------------------------------

create policy subscription_plans_public_read on public.subscription_plans
  for select using (is_active = true or public.is_staff());

create policy subscription_plans_admin_write on public.subscription_plans
  for all using (public.has_role('super_administrator'))
  with check (public.has_role('super_administrator'));

create policy subscriptions_select_own on public.subscriptions
  for select using (user_id = auth.uid());

create policy subscriptions_select_staff on public.subscriptions
  for select using (
    public.has_role('billing_manager', 'support_representative',
                    'super_administrator')
  );

-- Subscription rows are written only by the Stripe webhook handler running with
-- the service-role key. No client-side insert/update/delete policy exists.

create policy billing_events_select_staff on public.billing_events
  for select using (
    public.has_role('billing_manager', 'super_administrator')
  );

-- --- Reference data (public) ------------------------------------------------

create policy states_public_read on public.states
  for select using (is_active = true or public.is_staff());

create policy counties_public_read on public.counties
  for select using (is_active = true or public.is_staff());

create policy cities_public_read on public.cities
  for select using (is_active = true or public.is_staff());

create policy industries_public_read on public.industries
  for select using (is_active = true or public.is_staff());

create policy states_staff_write on public.states
  for all using (public.has_role('editor', 'super_administrator'))
  with check (public.has_role('editor', 'super_administrator'));

create policy counties_staff_write on public.counties
  for all using (public.has_role('editor', 'super_administrator'))
  with check (public.has_role('editor', 'super_administrator'));

create policy cities_staff_write on public.cities
  for all using (public.has_role('editor', 'super_administrator'))
  with check (public.has_role('editor', 'super_administrator'));

create policy industries_staff_write on public.industries
  for all using (public.has_role('editor', 'super_administrator'))
  with check (public.has_role('editor', 'super_administrator'));

-- --- Sources ----------------------------------------------------------------
-- The base table carries contact details and internal notes, so it stays
-- staff-only. Members read provenance through public.public_sources below.

create policy sources_staff_read on public.sources
  for select using (public.is_staff());

create policy sources_staff_write on public.sources
  for all using (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  );

create policy source_checks_staff on public.source_checks
  for all using (public.is_staff()) with check (public.is_staff());

create view public.public_sources
with (security_invoker = off) as
  select id, name, organization_name, source_type, website_url, jurisdiction,
         reliability_score, last_checked_at
  from public.sources
  where is_active = true;

comment on view public.public_sources is
  'Provenance fields safe to show on an opportunity detail page. Excludes '
  'contact details, internal notes and terms-review state.';

grant select on public.public_sources to anon, authenticated;

-- --- Opportunities ----------------------------------------------------------

create policy opportunities_read on public.opportunities
  for select using (
    public.can_view_opportunity(workflow_status, is_restricted,
                                minimum_access_rank)
  );

create policy opportunities_research_write on public.opportunities
  for insert with check (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  );

create policy opportunities_staff_update on public.opportunities
  for update using (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  );

create policy opportunities_admin_delete on public.opportunities
  for delete using (public.has_role('super_administrator'));

-- Child tables inherit the parent's visibility.
create policy score_components_read on public.opportunity_score_components
  for select using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and public.can_view_opportunity(o.workflow_status, o.is_restricted,
                                        o.minimum_access_rank)
    )
  );

create policy score_components_staff_write on public.opportunity_score_components
  for all using (
    public.has_role('reviewer', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('reviewer', 'editor', 'super_administrator')
  );

create policy opportunity_versions_staff_read on public.opportunity_versions
  for select using (public.is_staff());

create policy opportunity_sources_read on public.opportunity_sources
  for select using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and public.can_view_opportunity(o.workflow_status, o.is_restricted,
                                        o.minimum_access_rank)
    )
  );

create policy opportunity_sources_staff_write on public.opportunity_sources
  for all using (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  );

create policy opportunity_industries_read on public.opportunity_industries
  for select using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and public.can_view_opportunity(o.workflow_status, o.is_restricted,
                                        o.minimum_access_rank)
    )
  );

create policy opportunity_industries_staff_write on public.opportunity_industries
  for all using (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  );

create policy property_details_read on public.property_details
  for select using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and public.can_view_opportunity(o.workflow_status, o.is_restricted,
                                        o.minimum_access_rank)
    )
  );

create policy property_details_staff_write on public.property_details
  for all using (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  );

create policy funding_details_read on public.funding_details
  for select using (
    exists (
      select 1 from public.opportunities o
      where o.id = opportunity_id
        and public.can_view_opportunity(o.workflow_status, o.is_restricted,
                                        o.minimum_access_rank)
    )
  );

create policy funding_details_staff_write on public.funding_details
  for all using (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  );

-- --- Market data ------------------------------------------------------------

create policy market_indicators_read on public.market_indicators
  for select using (
    is_active = true
    and (public.is_staff() or public.my_access_rank() >= minimum_access_rank)
  );

create policy market_indicators_staff_write on public.market_indicators
  for all using (public.has_role('editor', 'super_administrator'))
  with check (public.has_role('editor', 'super_administrator'));

create policy market_indicator_values_read on public.market_indicator_values
  for select using (
    exists (
      select 1 from public.market_indicators mi
      where mi.id = indicator_id
        and mi.is_active = true
        and (public.is_staff()
             or public.my_access_rank() >= mi.minimum_access_rank)
    )
  );

create policy market_indicator_values_staff_write on public.market_indicator_values
  for all using (
    public.has_role('researcher', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('researcher', 'editor', 'super_administrator')
  );

-- --- Member-owned records ---------------------------------------------------
-- Saved records survive suspension and downgrade (spec 9), so these policies
-- check ownership only. Feature gating (limits, exports, alerts) happens in the
-- API layer where a clear upgrade message can be returned.

create policy saved_opportunities_own on public.saved_opportunities
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy saved_searches_own on public.saved_searches
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy alert_preferences_own on public.alert_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notification_deliveries_own on public.notification_deliveries
  for select using (
    exists (
      select 1 from public.notifications n
      where n.id = notification_id and n.user_id = auth.uid()
    )
  );

create policy export_jobs_own on public.export_jobs
  for select using (user_id = auth.uid());

-- --- Reports ----------------------------------------------------------------

create policy reports_read on public.reports
  for select using (
    public.is_staff()
    or (
      status = 'published'
      and published_at <= now()
      and (is_sample = true or public.my_access_rank() >= minimum_access_rank)
    )
  );

create policy reports_staff_write on public.reports
  for all using (public.has_role('editor', 'super_administrator'))
  with check (public.has_role('editor', 'super_administrator'));

create policy report_sections_read on public.report_sections
  for select using (
    exists (
      select 1 from public.reports r
      where r.id = report_id
        and (
          public.is_staff()
          or (r.status = 'published' and r.published_at <= now()
              and public.my_access_rank() >= report_sections.minimum_access_rank)
        )
    )
  );

create policy report_sections_staff_write on public.report_sections
  for all using (public.has_role('editor', 'super_administrator'))
  with check (public.has_role('editor', 'super_administrator'));

create policy report_opportunities_read on public.report_opportunities
  for select using (
    exists (
      select 1 from public.reports r
      where r.id = report_id
        and (
          public.is_staff()
          or (r.status = 'published' and r.published_at <= now()
              and public.my_access_rank()
                  >= report_opportunities.minimum_access_rank)
        )
    )
  );

create policy report_opportunities_staff_write on public.report_opportunities
  for all using (public.has_role('editor', 'super_administrator'))
  with check (public.has_role('editor', 'super_administrator'));

-- --- Attachments ------------------------------------------------------------

create policy attachments_read on public.attachments
  for select using (
    public.is_staff()
    or (
      public.my_access_rank() >= minimum_access_rank
      and (
        opportunity_id is null
        or exists (
          select 1 from public.opportunities o
          where o.id = attachments.opportunity_id
            and public.can_view_opportunity(o.workflow_status, o.is_restricted,
                                            o.minimum_access_rank)
        )
      )
      and (
        report_id is null
        or exists (
          select 1 from public.reports r
          where r.id = attachments.report_id
            and r.status = 'published'
            and public.my_access_rank() >= r.minimum_access_rank
        )
      )
    )
  );

create policy attachments_staff_write on public.attachments
  for all using (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('researcher', 'reviewer', 'editor', 'super_administrator')
  );

-- --- Support and corrections ------------------------------------------------

create policy support_tickets_own on public.support_tickets
  for select using (user_id = auth.uid());

-- A suspended account may still open an appeal, and nothing else (spec 9).
create policy support_tickets_insert on public.support_tickets
  for insert with check (
    user_id = auth.uid()
    and (public.account_is_active() or category = 'account')
  );

create policy support_tickets_staff on public.support_tickets
  for all using (
    public.has_role('support_representative', 'billing_manager',
                    'super_administrator')
  )
  with check (
    public.has_role('support_representative', 'billing_manager',
                    'super_administrator')
  );

create policy correction_requests_own on public.correction_requests
  for select using (submitted_by_user_id = auth.uid());

create policy correction_requests_insert on public.correction_requests
  for insert with check (
    submitted_by_user_id = auth.uid() and public.account_is_active()
  );

create policy correction_requests_staff on public.correction_requests
  for all using (
    public.has_role('reviewer', 'editor', 'super_administrator')
  )
  with check (
    public.has_role('reviewer', 'editor', 'super_administrator')
  );

-- --- Audit, jobs, analytics -------------------------------------------------

-- Read-only to administrators; written exclusively by SECURITY DEFINER
-- triggers and service-role jobs. No update or delete policy exists at all,
-- so the trail is append-only from every client key.
create policy audit_logs_admin_read on public.audit_logs
  for select using (public.has_role('super_administrator'));

create policy job_runs_admin_read on public.job_runs
  for select using (
    public.has_role('editor', 'billing_manager', 'super_administrator')
  );

create policy analytics_events_insert_self on public.analytics_events
  for insert with check (user_id is null or user_id = auth.uid());

create policy analytics_events_admin_read on public.analytics_events
  for select using (public.has_role('super_administrator'));
