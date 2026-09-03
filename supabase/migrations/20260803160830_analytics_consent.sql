-- Recovered from the live database (project bbgikfblcahhvrpxiqnd), applied
-- 2026-08-03 and never committed. Reproduced verbatim from the statement
-- Supabase recorded in supabase_migrations.schema_migrations.

alter table public.user_preferences
  add column if not exists analytics_enabled boolean not null default true;

comment on column public.user_preferences.analytics_enabled is
  'Member consent for product analytics. Enforced in track(); when false, no '
  'analytics_events row is written and nothing is forwarded to the vendor.';
