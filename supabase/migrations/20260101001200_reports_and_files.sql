-- ---------------------------------------------------------------------------
-- 0012 — Reports, report composition, attachments, exports (spec 7.12, 7.13)
-- ---------------------------------------------------------------------------

create table public.reports (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  slug text not null unique,
  report_type public.report_type not null default 'weekly',
  reporting_period_start date,
  reporting_period_end date,
  executive_summary jsonb,
  market_commentary jsonb,
  minimum_access_rank integer not null default 0
    check (minimum_access_rank >= 0),
  status public.report_status not null default 'draft',
  scheduled_at timestamptz,
  published_at timestamptz,
  distributed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  pdf_file_path text,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint report_period_ordered check (
    reporting_period_start is null or reporting_period_end is null
    or reporting_period_start <= reporting_period_end
  ),
  constraint published_report_requires_timestamp check (
    status <> 'published' or published_at is not null
  )
);

create index reports_status_published_idx
  on public.reports (status, published_at desc);
create index reports_type_idx on public.reports (report_type);
create index reports_access_rank_idx on public.reports (minimum_access_rank);

select public.attach_updated_at('public.reports');

alter table public.notifications
  add constraint notifications_report_fk
  foreign key (report_id) references public.reports (id) on delete cascade;

create table public.report_sections (
  id uuid primary key default extensions.gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  section_type public.report_section_type not null default 'custom',
  title text not null,
  content jsonb,
  minimum_access_rank integer not null default 0
    check (minimum_access_rank >= 0),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index report_sections_report_idx
  on public.report_sections (report_id, display_order);

select public.attach_updated_at('public.report_sections');

create table public.report_opportunities (
  report_id uuid not null references public.reports (id) on delete cascade,
  opportunity_id uuid not null
    references public.opportunities (id) on delete cascade,
  display_order integer not null default 0,
  editor_commentary text,
  minimum_access_rank integer not null default 0
    check (minimum_access_rank >= 0),
  created_at timestamptz not null default now(),
  primary key (report_id, opportunity_id)
);

create index report_opportunities_order_idx
  on public.report_opportunities (report_id, display_order);
create index report_opportunities_opportunity_idx
  on public.report_opportunities (opportunity_id);

-- --- Attachments ------------------------------------------------------------

create table public.attachments (
  id uuid primary key default extensions.gen_random_uuid(),
  opportunity_id uuid references public.opportunities (id) on delete cascade,
  report_id uuid references public.reports (id) on delete cascade,
  file_name text not null,
  file_path text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  minimum_access_rank integer not null default 0
    check (minimum_access_rank >= 0),
  checksum text,
  scan_status text not null default 'pending',
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attachment_has_parent check (
    opportunity_id is not null or report_id is not null
  ),
  constraint attachment_mime_allowed check (
    mime_type in (
      'application/pdf',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'image/png',
      'image/jpeg',
      'image/webp'
    )
  )
);

create index attachments_opportunity_idx on public.attachments (opportunity_id);
create index attachments_report_idx on public.attachments (report_id);

select public.attach_updated_at('public.attachments');

-- --- Exports ----------------------------------------------------------------

create table public.export_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  format public.export_format not null default 'csv',
  status public.export_status not null default 'queued',
  filter_configuration jsonb not null default '{}'::jsonb,
  saved_search_id uuid references public.saved_searches (id) on delete set null,
  opportunity_ids uuid[],
  row_count integer,
  file_path text,
  error_message text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index export_jobs_user_idx on public.export_jobs (user_id, requested_at desc);
create index export_jobs_pending_idx
  on public.export_jobs (requested_at)
  where status in ('queued', 'processing');

select public.attach_updated_at('public.export_jobs');
