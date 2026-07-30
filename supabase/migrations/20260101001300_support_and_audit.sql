-- ---------------------------------------------------------------------------
-- 0013 — Support, corrections, audit log, job runs (spec 7.14, 7.15, 17)
-- ---------------------------------------------------------------------------

create table public.support_tickets (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  subject text not null,
  category public.support_category not null default 'other',
  priority public.support_priority not null default 'normal',
  status public.support_status not null default 'open',
  message text not null,
  assigned_to uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_tickets_user_idx
  on public.support_tickets (user_id, created_at desc);
create index support_tickets_queue_idx
  on public.support_tickets (status, priority, created_at);

select public.attach_updated_at('public.support_tickets');

create table public.correction_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  submitted_by_user_id uuid references public.profiles (id) on delete set null,
  opportunity_id uuid references public.opportunities (id) on delete cascade,
  report_id uuid references public.reports (id) on delete cascade,
  description text not null,
  supporting_url text,
  status public.correction_status not null default 'submitted',
  reviewed_by uuid references public.profiles (id) on delete set null,
  resolution_notes text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint correction_has_target check (
    opportunity_id is not null or report_id is not null
  )
);

create index correction_requests_status_idx
  on public.correction_requests (status, created_at);
create index correction_requests_opportunity_idx
  on public.correction_requests (opportunity_id);

select public.attach_updated_at('public.correction_requests');

-- --- Audit log --------------------------------------------------------------

create table public.audit_logs (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_values jsonb,
  new_values jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only. No update or delete policy is ever granted, including to '
  'super administrators, so the trail cannot be rewritten from the API.';

create index audit_logs_entity_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx
  on public.audit_logs (actor_user_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- --- Background job runs ----------------------------------------------------

create table public.job_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  job_name text not null,
  status public.job_status not null default 'queued',
  -- Idempotency guard: a job keyed for a given window runs at most once.
  idempotency_key text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  records_processed integer not null default 0,
  records_failed integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index job_runs_idempotency_idx
  on public.job_runs (job_name, idempotency_key)
  where idempotency_key is not null;
create index job_runs_recent_idx on public.job_runs (job_name, started_at desc);

select public.attach_updated_at('public.job_runs');

-- --- Analytics events -------------------------------------------------------
-- Mirrors the product-analytics stream so subscription funnels stay queryable
-- even if the external analytics vendor changes (spec 19). Deliberately holds
-- no personal detail beyond the user id.

create table public.analytics_events (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  anonymous_id text,
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index analytics_events_name_idx
  on public.analytics_events (event_name, occurred_at desc);
create index analytics_events_user_idx
  on public.analytics_events (user_id, occurred_at desc);
