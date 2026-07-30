-- ---------------------------------------------------------------------------
-- 0006 — Sources and source checks (spec 7.4)
--
-- Provenance is a first-class product requirement: every opportunity must be
-- traceable to a source whose terms have been reviewed.
-- ---------------------------------------------------------------------------

create table public.sources (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  organization_name text,
  source_type public.source_type not null,
  website_url text not null,
  jurisdiction text,
  reliability_score integer not null default 8
    check (reliability_score between 0 and 15),
  update_frequency public.update_frequency,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  rss_url text,
  api_available boolean not null default false,
  api_documentation_url text,
  automation_allowed boolean not null default false,
  scraping_review_status public.scraping_review_status
    not null default 'not_reviewed',
  terms_reviewed_at timestamptz,
  contact_name text,
  contact_email text,
  internal_notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Automation may only be switched on after the terms of use have been read
  -- and the review recorded a permissive outcome.
  constraint automation_requires_review check (
    automation_allowed = false
    or (
      terms_reviewed_at is not null
      and scraping_review_status in ('permitted', 'permitted_with_limits')
    )
  )
);

comment on column public.sources.reliability_score is
  'Feeds the source-reliability component of the opportunity score (max 15).';

create index sources_type_idx on public.sources (source_type);
create index sources_active_idx on public.sources (is_active);
create index sources_next_check_idx on public.sources (next_check_at)
  where is_active = true;

select public.attach_updated_at('public.sources');

create table public.source_checks (
  id uuid primary key default extensions.gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete cascade,
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz not null default now(),
  status public.source_check_status not null,
  records_found integer not null default 0 check (records_found >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index source_checks_source_idx
  on public.source_checks (source_id, checked_at desc);

select public.attach_updated_at('public.source_checks');

-- Recording a check advances the source's freshness clock.
create or replace function public.apply_source_check()
returns trigger
language plpgsql
as $$
declare
  cadence interval;
begin
  select case sources.update_frequency
           when 'realtime'  then interval '1 day'
           when 'daily'     then interval '2 days'
           when 'weekly'    then interval '8 days'
           when 'biweekly'  then interval '15 days'
           when 'monthly'   then interval '32 days'
           when 'quarterly' then interval '95 days'
           when 'annually'  then interval '370 days'
           else interval '30 days'
         end
    into cadence
  from public.sources
  where sources.id = new.source_id;

  update public.sources
  set last_checked_at = new.checked_at,
      next_check_at = new.checked_at + coalesce(cadence, interval '30 days')
  where id = new.source_id;

  return new;
end;
$$;

create trigger on_source_check_recorded
  after insert on public.source_checks
  for each row execute function public.apply_source_check();
