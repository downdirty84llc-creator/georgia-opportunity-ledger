-- ---------------------------------------------------------------------------
-- 0017 — Lifecycle flags, version history, audit triggers (spec 7.15, 15, 18)
-- ---------------------------------------------------------------------------

-- Days before a deadline at which a record is treated as closing soon.
create or replace function public.closing_soon_window()
returns interval
language sql
immutable
as $$ select interval '14 days'; $$;

-- How long a published record may go unverified before reverification is due.
create or replace function public.reverification_interval()
returns interval
language sql
immutable
as $$ select interval '30 days'; $$;

-- --- Audit ------------------------------------------------------------------

create or replace function public.write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_previous jsonb,
  p_new jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id, previous_values, new_values
  )
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_previous, p_new);
end;
$$;

-- --- Opportunity lifecycle --------------------------------------------------

create or replace function public.maintain_opportunity_lifecycle()
returns trigger
language plpgsql
as $$
begin
  -- Derived deadline flags. The daily job recomputes these across the table so
  -- that the passage of time alone flips them; this trigger keeps a row honest
  -- the moment it is written.
  if new.closing_date is null then
    new.is_closing_soon := false;
    new.is_expired := false;
  else
    new.is_expired := new.closing_date < now();
    new.is_closing_soon :=
      not new.is_expired
      and new.closing_date <= now() + public.closing_soon_window();
  end if;

  -- An information-only record has no deadline semantics.
  if new.status = 'information_only' then
    new.is_closing_soon := false;
  end if;

  new.reverification_due_at :=
    (new.date_verified::timestamptz) + public.reverification_interval();

  -- Publishing stamps the record; unpublishing clears the stamp so the
  -- "published" invariant in the table constraint stays true.
  if tg_op = 'UPDATE' then
    if new.workflow_status = 'published' and old.workflow_status <> 'published'
       and new.published_at is null then
      new.published_at := now();
      new.published_by := coalesce(new.published_by, auth.uid());
    end if;
  elsif tg_op = 'INSERT' then
    if new.workflow_status = 'published' and new.published_at is null then
      new.published_at := now();
      new.published_by := coalesce(new.published_by, auth.uid());
    end if;
  end if;

  return new;
end;
$$;

create trigger maintain_opportunity_lifecycle_trigger
  before insert or update on public.opportunities
  for each row execute function public.maintain_opportunity_lifecycle();

-- --- Version history and material-change detection --------------------------
--
-- The fields listed here are the ones spec 18 calls material: a change to any
-- of them may trigger a member alert, so each one is snapshotted.

create or replace function public.opportunity_change_is_material(
  old_row public.opportunities,
  new_row public.opportunities
)
returns boolean
language sql
immutable
as $$
  select
    old_row.closing_date is distinct from new_row.closing_date
    or old_row.opening_date is distinct from new_row.opening_date
    or old_row.eligibility_summary is distinct from new_row.eligibility_summary
    or old_row.estimated_value_min is distinct from new_row.estimated_value_min
    or old_row.estimated_value_max is distinct from new_row.estimated_value_max
    or old_row.capital_required_min is distinct from new_row.capital_required_min
    or old_row.capital_required_max is distinct from new_row.capital_required_max
    or old_row.risk_summary is distinct from new_row.risk_summary
    or old_row.restrictions is distinct from new_row.restrictions
    or old_row.status is distinct from new_row.status
    or old_row.score is distinct from new_row.score
    or old_row.minimum_access_rank is distinct from new_row.minimum_access_rank
    or old_row.original_source_url is distinct from new_row.original_source_url;
$$;

create or replace function public.record_opportunity_version()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  next_version integer;
  material boolean;
  summary text;
begin
  material := public.opportunity_change_is_material(old, new);

  -- Only significant changes are versioned; routine edits to internal notes do
  -- not fill the history with noise.
  if not material and old.workflow_status = new.workflow_status then
    return new;
  end if;

  select coalesce(max(version_number), 0) + 1
    into next_version
  from public.opportunity_versions
  where opportunity_id = new.id;

  summary := case
    when old.workflow_status is distinct from new.workflow_status
      then format('Workflow %s → %s', old.workflow_status, new.workflow_status)
    else 'Material field change'
  end;

  insert into public.opportunity_versions (
    opportunity_id, version_number, record_snapshot, change_summary,
    is_material_change, changed_by
  )
  values (
    new.id, next_version, to_jsonb(new), summary, material, auth.uid()
  );

  return new;
end;
$$;

create trigger record_opportunity_version_trigger
  after update on public.opportunities
  for each row execute function public.record_opportunity_version();

-- --- Audited opportunity actions --------------------------------------------

create or replace function public.audit_opportunity_changes()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if tg_op = 'DELETE' then
    perform public.write_audit_log(
      'opportunity.deleted', 'opportunity', old.id, to_jsonb(old), null
    );
    return old;
  end if;

  if old.workflow_status <> 'published' and new.workflow_status = 'published' then
    perform public.write_audit_log(
      'opportunity.published', 'opportunity', new.id,
      jsonb_build_object('workflow_status', old.workflow_status),
      jsonb_build_object('workflow_status', new.workflow_status,
                         'published_at', new.published_at)
    );
  elsif old.workflow_status = 'published' and new.workflow_status <> 'published' then
    perform public.write_audit_log(
      'opportunity.unpublished', 'opportunity', new.id,
      jsonb_build_object('workflow_status', old.workflow_status),
      jsonb_build_object('workflow_status', new.workflow_status)
    );
  end if;

  if old.score is distinct from new.score then
    perform public.write_audit_log(
      'opportunity.score_changed', 'opportunity', new.id,
      jsonb_build_object('score', old.score,
                         'classification', old.score_classification),
      jsonb_build_object('score', new.score,
                         'classification', new.score_classification)
    );
  end if;

  if old.minimum_access_rank is distinct from new.minimum_access_rank
     or old.is_restricted is distinct from new.is_restricted then
    perform public.write_audit_log(
      'opportunity.access_changed', 'opportunity', new.id,
      jsonb_build_object('minimum_access_rank', old.minimum_access_rank,
                         'is_restricted', old.is_restricted),
      jsonb_build_object('minimum_access_rank', new.minimum_access_rank,
                         'is_restricted', new.is_restricted)
    );
  end if;

  return new;
end;
$$;

create trigger audit_opportunity_changes_trigger
  after update or delete on public.opportunities
  for each row execute function public.audit_opportunity_changes();

-- --- Audited account actions ------------------------------------------------

create or replace function public.audit_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.role is distinct from new.role then
    perform public.write_audit_log(
      'user.role_changed', 'profile', new.id,
      jsonb_build_object('role', old.role),
      jsonb_build_object('role', new.role)
    );
  end if;

  if old.account_status is distinct from new.account_status then
    perform public.write_audit_log(
      case new.account_status
        when 'suspended' then 'user.suspended'
        when 'closed' then 'user.closed'
        else 'user.reinstated'
      end,
      'profile', new.id,
      jsonb_build_object('account_status', old.account_status),
      jsonb_build_object('account_status', new.account_status)
    );
  end if;

  if old.access_rank_override is distinct from new.access_rank_override then
    perform public.write_audit_log(
      'subscription.override', 'profile', new.id,
      jsonb_build_object('access_rank_override', old.access_rank_override),
      jsonb_build_object('access_rank_override', new.access_rank_override,
                         'expires_at', new.access_rank_override_expires_at,
                         'reason', new.access_rank_override_reason)
    );
  end if;

  return new;
end;
$$;

create trigger audit_profile_changes_trigger
  after update on public.profiles
  for each row execute function public.audit_profile_changes();

create or replace function public.audit_source_deletion()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform public.write_audit_log(
    'source.deleted', 'source', old.id, to_jsonb(old), null
  );
  return old;
end;
$$;

create trigger audit_source_deletion_trigger
  after delete on public.sources
  for each row execute function public.audit_source_deletion();

create or replace function public.audit_correction_publication()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.status is distinct from new.status and new.status = 'published' then
    perform public.write_audit_log(
      'correction.published', 'correction_request', new.id,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status,
                         'resolution_notes', new.resolution_notes)
    );
  end if;
  return new;
end;
$$;

create trigger audit_correction_publication_trigger
  after update on public.correction_requests
  for each row execute function public.audit_correction_publication();

-- --- Callable audit entry point ---------------------------------------------
--
-- write_audit_log is SECURITY DEFINER and is called by the triggers above. A
-- SECURITY DEFINER function is granted to PUBLIC by default, which would let
-- any signed-in member forge audit entries, so execution is revoked and the
-- application calls the guarded wrapper instead.

revoke all on function public.write_audit_log(text, text, uuid, jsonb, jsonb)
  from public;

create or replace function public.log_admin_action(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_previous jsonb default null,
  p_new jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.is_staff() then
    raise exception 'Only staff may write audit entries'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.write_audit_log(
    p_action, p_entity_type, p_entity_id, p_previous, p_new
  );
end;
$$;

revoke all on function public.log_admin_action(text, text, uuid, jsonb, jsonb)
  from public;
grant execute on function public.log_admin_action(text, text, uuid, jsonb, jsonb)
  to authenticated, service_role;
