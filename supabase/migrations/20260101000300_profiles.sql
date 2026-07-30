-- ---------------------------------------------------------------------------
-- 0003 — Profiles and member preferences (spec 7.1)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  display_name text,
  company_name text,
  phone text,
  role public.user_role not null default 'member',
  account_status public.account_status not null default 'active',
  onboarding_complete boolean not null default false,
  last_login_at timestamptz,
  terms_accepted_at timestamptz,
  privacy_accepted_at timestamptz,
  -- Lets support/billing grant a temporary access rank without touching Stripe.
  -- Every write here is audited (see 0014).
  access_rank_override integer
    check (access_rank_override is null
           or access_rank_override between 0 and 100),
  access_rank_override_expires_at timestamptz,
  access_rank_override_reason text,
  deletion_requested_at timestamptz,
  -- Demo accounts loaded by the seeder. Excluded from product analytics and
  -- from any production revenue reporting (spec 27).
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.access_rank_override is
  'Administrative grant of paid access. Audited as a subscription override.';

select public.attach_updated_at('public.profiles');

create index profiles_role_idx on public.profiles (role);
create index profiles_account_status_idx on public.profiles (account_status);

create table public.user_preferences (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  primary_user_type public.primary_user_type,
  capital_range_min numeric(14, 2),
  capital_range_max numeric(14, 2),
  preferred_frequency public.delivery_frequency not null default 'weekly',
  email_alerts_enabled boolean not null default true,
  marketing_email_enabled boolean not null default false,
  timezone text not null default 'America/New_York',
  preferred_state_ids uuid[] not null default '{}',
  preferred_county_ids uuid[] not null default '{}',
  preferred_industry_ids uuid[] not null default '{}',
  preferred_property_types text[] not null default '{}',
  preferred_funding_types text[] not null default '{}',
  minimum_score integer not null default 0 check (minimum_score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capital_range_ordered check (
    capital_range_min is null
    or capital_range_max is null
    or capital_range_min <= capital_range_max
  )
);

select public.attach_updated_at('public.user_preferences');

-- A profile row must exist for every authenticated user. Creating it in the
-- database (rather than in the application) guarantees the invariant even when
-- a user signs up through a provider flow the application never sees.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into public.profiles (id, first_name, last_name, display_name)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;

  insert into public.user_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
