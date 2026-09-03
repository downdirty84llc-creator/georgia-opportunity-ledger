-- Recovered from the live database (project bbgikfblcahhvrpxiqnd), applied
-- 2026-08-10 and never committed. Reproduced verbatim from the statement
-- Supabase recorded in supabase_migrations.schema_migrations.
--
-- NOTE: the column comment this installs says only `clean` is served, while
-- docs/RUNBOOK.md in this repository says members see `clean` and `skipped`.
-- Both cannot be true. See the commit that restored this file — the divergence
-- is recorded there rather than silently resolved here, because changing either
-- one is a product decision about whether an unscanned file is readable.

update public.attachments
set scan_status = 'pending'
where scan_status is null
   or scan_status not in
      ('pending', 'scanning', 'clean', 'infected', 'failed', 'skipped');

alter table public.attachments
  drop constraint if exists attachment_scan_status_known;

alter table public.attachments
  add constraint attachment_scan_status_known
  check (scan_status in
    ('pending', 'scanning', 'clean', 'infected', 'failed', 'skipped'));

comment on column public.attachments.scan_status is
  'Malware scan result. Only `clean` is served; every other value, including '
  'an unrecognised one, is withheld by canServeAttachment().';

create index if not exists attachments_scan_status_idx
  on public.attachments (scan_status, uploaded_at)
  where scan_status in ('pending', 'scanning');
