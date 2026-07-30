-- ---------------------------------------------------------------------------
-- 0011 — Saved records, saved searches, alerts, notifications (spec 7.10, 7.11)
-- ---------------------------------------------------------------------------

create table public.saved_opportunities (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  opportunity_id uuid not null
    references public.opportunities (id) on delete cascade,
  status public.saved_status not null default 'reviewing',
  personal_notes text,
  follow_up_date date,
  -- Lets the saved list flag "changed since you saved it" without diffing.
  opportunity_version_at_save integer,
  saved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, opportunity_id)
);

create index saved_opportunities_user_idx
  on public.saved_opportunities (user_id, saved_at desc);
create index saved_opportunities_follow_up_idx
  on public.saved_opportunities (user_id, follow_up_date)
  where follow_up_date is not null;

select public.attach_updated_at('public.saved_opportunities');

create table public.saved_searches (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  filter_configuration jsonb not null default '{}'::jsonb,
  minimum_score integer not null default 0
    check (minimum_score between 0 and 100),
  alert_enabled boolean not null default true,
  alert_frequency public.delivery_frequency not null default 'immediate',
  last_run_at timestamptz,
  last_match_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create index saved_searches_alerting_idx
  on public.saved_searches (alert_frequency, last_run_at)
  where alert_enabled = true;

select public.attach_updated_at('public.saved_searches');

create table public.alert_preferences (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  alert_type public.alert_type not null,
  delivery_method public.delivery_method not null default 'email',
  enabled boolean not null default true,
  minimum_score integer not null default 0
    check (minimum_score between 0 and 100),
  filter_configuration jsonb not null default '{}'::jsonb,
  frequency public.delivery_frequency not null default 'immediate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, alert_type, delivery_method)
);

create index alert_preferences_user_idx on public.alert_preferences (user_id);
create index alert_preferences_type_idx
  on public.alert_preferences (alert_type)
  where enabled = true;

select public.attach_updated_at('public.alert_preferences');

create table public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  notification_type public.notification_type not null,
  title text not null,
  message text not null,
  opportunity_id uuid references public.opportunities (id) on delete cascade,
  report_id uuid,
  action_url text,
  is_read boolean not null default false,
  sent_at timestamptz not null default now(),
  read_at timestamptz,
  -- Deduplication key. Two notifications sharing a key are the same event for
  -- the same user, which is how repeat alerts are suppressed (spec 18).
  dedupe_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notifications_user_idx
  on public.notifications (user_id, sent_at desc);
create index notifications_unread_idx
  on public.notifications (user_id)
  where is_read = false;
create unique index notifications_dedupe_idx
  on public.notifications (user_id, dedupe_key)
  where dedupe_key is not null;

select public.attach_updated_at('public.notifications');

create table public.notification_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  notification_id uuid not null
    references public.notifications (id) on delete cascade,
  delivery_method public.delivery_method not null,
  provider_message_id text,
  delivery_status public.delivery_status not null default 'queued',
  attempted_at timestamptz not null default now(),
  delivered_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notification_deliveries_notification_idx
  on public.notification_deliveries (notification_id);
create index notification_deliveries_status_idx
  on public.notification_deliveries (delivery_status, attempted_at);

select public.attach_updated_at('public.notification_deliveries');
