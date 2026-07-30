-- ---------------------------------------------------------------------------
-- 0004 — Subscription plans, subscriptions, Stripe webhook ledger (spec 7.2)
-- ---------------------------------------------------------------------------

create table public.subscription_plans (
  id uuid primary key default extensions.gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text not null,
  monthly_price numeric(10, 2) not null check (monthly_price >= 0),
  annual_price numeric(10, 2) not null check (annual_price >= 0),
  stripe_monthly_price_id text,
  stripe_annual_price_id text,
  access_rank integer not null unique check (access_rank >= 0),
  is_active boolean not null default true,
  display_order integer not null default 0,
  is_recommended boolean not null default false,
  feature_configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.subscription_plans.feature_configuration is
  'Authoritative entitlement document: saved-opportunity limits, saved-search '
  'limits, export permission, alert permissions, archive depth.';

select public.attach_updated_at('public.subscription_plans');

create table public.subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id uuid not null references public.subscription_plans (id),
  stripe_customer_id text,
  stripe_subscription_id text unique,
  billing_interval public.billing_interval not null default 'monthly',
  status public.subscription_status not null default 'free',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  canceled_at timestamptz,
  founding_member boolean not null default false,
  pricing_lock_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active subscription record per user. Historical Stripe subscriptions are
-- reconstructable from billing_events, so a single mutable row keeps access
-- resolution unambiguous.
create unique index subscriptions_user_id_key on public.subscriptions (user_id);
create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;
create index subscriptions_period_end_idx on public.subscriptions (current_period_end);

select public.attach_updated_at('public.subscriptions');

create table public.billing_events (
  id uuid primary key default extensions.gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  user_id uuid references public.profiles (id) on delete set null,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  event_payload jsonb not null,
  processed boolean not null default false,
  processed_at timestamptz,
  processing_error text,
  attempt_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_events is
  'Append-only Stripe webhook ledger. The unique stripe_event_id makes webhook '
  'processing idempotent under Stripe retries.';

create index billing_events_unprocessed_idx
  on public.billing_events (created_at)
  where processed = false;
create index billing_events_type_idx on public.billing_events (event_type);

select public.attach_updated_at('public.billing_events');

-- Every user gets a free subscription row on signup so access resolution never
-- has to special-case a missing record.
create or replace function public.ensure_free_subscription()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  free_plan_id uuid;
begin
  select id into free_plan_id
  from public.subscription_plans
  where access_rank = 0 and is_active
  order by display_order
  limit 1;

  if free_plan_id is null then
    return new;
  end if;

  insert into public.subscriptions (user_id, plan_id, status)
  values (new.id, free_plan_id, 'free')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_profile_created_ensure_subscription
  after insert on public.profiles
  for each row execute function public.ensure_free_subscription();
