-- ---------------------------------------------------------------------------
-- 0022 — Attachment scanning (spec 20)
--
-- `attachments.scan_status` existed from the start but nothing set it and
-- nothing read it, which meant an uploaded file was downloadable the instant
-- it landed. This migration turns the column into an enforced state machine
-- and makes the read policy respect it.
-- ---------------------------------------------------------------------------

alter table public.attachments
  add column if not exists scanned_at timestamptz,
  add column if not exists scan_detail text,
  add column if not exists scanner text,
  add column if not exists scan_attempts integer not null default 0;

-- Existing rows predate scanning. They are 'pending', which the read policy
-- below withholds from members until a scan has actually run — the safe
-- direction for a column that used to mean nothing.
update public.attachments
set scan_status = 'pending'
where scan_status not in
  ('pending', 'scanning', 'clean', 'infected', 'failed', 'skipped');

alter table public.attachments
  drop constraint if exists attachment_scan_status_known;

alter table public.attachments
  add constraint attachment_scan_status_known check (
    scan_status in
      ('pending', 'scanning', 'clean', 'infected', 'failed', 'skipped')
  );

-- An infected file must say why. A verdict with no detail is not actionable
-- and, more importantly, is indistinguishable from a bug that set the column.
alter table public.attachments
  drop constraint if exists attachment_infected_has_detail;

alter table public.attachments
  add constraint attachment_infected_has_detail check (
    scan_status <> 'infected' or scan_detail is not null
  );

-- The rescan job's work queue: anything not yet resolved, oldest first.
create index if not exists attachments_scan_pending_idx
  on public.attachments (uploaded_at)
  where scan_status in ('pending', 'scanning', 'failed');

comment on column public.attachments.scan_status is
  'pending → scanning → clean | infected | failed | skipped. Members may read '
  'only clean and skipped; staff see everything so a quarantined file is '
  'visible to whoever has to deal with it.';

-- --- Read policy ------------------------------------------------------------
--
-- Replaces the policy in 0016. The access-rank and parent-visibility rules are
-- unchanged; the scan gate is added on top of them, because a file the member
-- is entitled to read is still a file we have not established is safe.
--
-- 'skipped' is readable. It means no scanner is configured, which is a
-- deployment decision recorded in the runbook rather than a per-file verdict —
-- withholding every attachment in that case would break the product silently
-- instead of loudly.

drop policy if exists attachments_read on public.attachments;

create policy attachments_read on public.attachments
  for select using (
    public.is_staff()
    or (
      scan_status in ('clean', 'skipped')
      and public.my_access_rank() >= minimum_access_rank
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
