-- ---------------------------------------------------------------------------
-- 0005 — Geographic reference data (spec 7.3)
--
-- Modelled state → county → city rather than Georgia-only columns so that
-- expansion to another state is a data load, not a migration (spec 2.13).
-- ---------------------------------------------------------------------------

create table public.states (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  abbreviation text not null,
  slug text not null unique,
  country_code text not null default 'US',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (country_code, abbreviation)
);

select public.attach_updated_at('public.states');

create table public.counties (
  id uuid primary key default extensions.gen_random_uuid(),
  state_id uuid not null references public.states (id) on delete cascade,
  name text not null,
  slug text not null,
  fips_code text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  population integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (state_id, slug)
);

create index counties_state_idx on public.counties (state_id);
create index counties_name_trgm_idx
  on public.counties using gin (name extensions.gin_trgm_ops);

select public.attach_updated_at('public.counties');

create table public.cities (
  id uuid primary key default extensions.gen_random_uuid(),
  county_id uuid not null references public.counties (id) on delete cascade,
  name text not null,
  slug text not null,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (county_id, slug)
);

create index cities_county_idx on public.cities (county_id);

select public.attach_updated_at('public.cities');
