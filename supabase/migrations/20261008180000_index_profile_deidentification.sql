-- Support the ON DELETE SET NULL lookups used when an account is purged.
-- PostgreSQL does not automatically index the referencing side of a foreign
-- key. Keep the de-identification relationships, but avoid scanning each whole
-- table to find rows belonging to the deleted profile.
--
-- These indexes address growth, not the separately reported SQL-delete timeout:
-- the production probe was deleted through Auth before these indexes existed.

create index attachments_uploaded_by_idx on public.attachments (uploaded_by);
create index billing_events_user_id_idx on public.billing_events (user_id);
create index correction_requests_reviewed_by_idx
  on public.correction_requests (reviewed_by);
create index correction_requests_submitted_by_user_id_idx
  on public.correction_requests (submitted_by_user_id);
create index opportunities_created_by_idx on public.opportunities (created_by);
create index opportunities_published_by_idx on public.opportunities (published_by);
create index opportunity_score_components_adjusted_by_idx
  on public.opportunity_score_components (adjusted_by);
create index opportunity_versions_changed_by_idx
  on public.opportunity_versions (changed_by);
create index reports_approved_by_idx on public.reports (approved_by);
create index reports_created_by_idx on public.reports (created_by);
create index source_checks_checked_by_idx on public.source_checks (checked_by);
create index support_tickets_assigned_to_idx on public.support_tickets (assigned_to);
