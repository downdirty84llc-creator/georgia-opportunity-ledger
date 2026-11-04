-- Publishing a report must not implicitly authorize sending it by email.
-- Existing reports default to web-only; do not infer consent from publication.
alter table public.reports
  add column email_distribution_enabled boolean not null default false;

comment on column public.reports.email_distribution_enabled is
  'Editor explicitly requested email distribution when publishing or scheduling.';
