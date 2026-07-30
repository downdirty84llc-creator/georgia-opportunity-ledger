-- ---------------------------------------------------------------------------
-- 0008 — Opportunities, scoring components, versions, supporting sources
-- (spec 7.5)
-- ---------------------------------------------------------------------------

create table public.opportunities (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null,
  slug text not null unique,
  category public.opportunity_category not null,
  subtype text not null,
  summary text not null,
  full_analysis jsonb,
  status public.opportunity_status not null default 'open',
  workflow_status public.workflow_status not null default 'draft',

  state_id uuid references public.states (id) on delete set null,
  county_id uuid references public.counties (id) on delete set null,
  city_id uuid references public.cities (id) on delete set null,
  street_address text,
  latitude numeric(9, 6),
  longitude numeric(9, 6),

  industry_id uuid references public.industries (id) on delete set null,
  source_id uuid not null references public.sources (id) on delete restrict,
  original_source_url text not null,

  date_discovered date not null default current_date,
  date_verified date not null default current_date,
  last_reviewed_at timestamptz,
  reverification_due_at timestamptz,

  opening_date timestamptz,
  closing_date timestamptz,

  estimated_value_min numeric(14, 2),
  estimated_value_max numeric(14, 2),
  capital_required_min numeric(14, 2),
  capital_required_max numeric(14, 2),
  deposit_required numeric(14, 2),

  eligibility_summary text,
  required_documents jsonb not null default '[]'::jsonb,
  restrictions text,
  risk_summary text not null,
  recommended_next_action text not null,

  score integer not null default 0 check (score between 0 and 100),
  score_classification public.score_classification
    not null default 'information_only',
  score_explanation text not null default '',
  verification_status public.verification_status not null default 'unverified',

  minimum_access_rank integer not null default 0
    check (minimum_access_rank >= 0),
  -- Set when a record must be withheld from all members regardless of rank
  -- (for example a source dispute or a pending correction).
  is_restricted boolean not null default false,
  restriction_reason text,

  is_featured boolean not null default false,
  is_closing_soon boolean not null default false,
  is_expired boolean not null default false,

  published_at timestamptz,
  published_by uuid references public.profiles (id) on delete set null,
  scheduled_at timestamptz,
  internal_notes text,

  -- Seed and demo records carry this flag so they can be surfaced with a
  -- "sample data" badge and excluded from production analytics (spec 27).
  is_sample boolean not null default false,

  search_vector tsvector,

  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint estimated_value_ordered check (
    estimated_value_min is null or estimated_value_max is null
    or estimated_value_min <= estimated_value_max
  ),
  constraint capital_required_ordered check (
    capital_required_min is null or capital_required_max is null
    or capital_required_min <= capital_required_max
  ),
  constraint opportunity_window_ordered check (
    opening_date is null or closing_date is null
    or opening_date <= closing_date
  ),
  constraint published_requires_timestamp check (
    workflow_status <> 'published' or published_at is not null
  ),
  constraint restriction_requires_reason check (
    is_restricted = false or restriction_reason is not null
  )
);

comment on column public.opportunities.minimum_access_rank is
  'Lowest plan access rank that may read the full record. Server-side checks '
  'in the API compare this against the caller''s effective rank.';

select public.attach_updated_at('public.opportunities');

-- --- Score components (spec 7.5, 12) ---------------------------------------

create table public.opportunity_score_components (
  id uuid primary key default extensions.gen_random_uuid(),
  opportunity_id uuid not null unique
    references public.opportunities (id) on delete cascade,
  financial_value_score integer not null default 0
    check (financial_value_score between 0 and 25),
  accessibility_score integer not null default 0
    check (accessibility_score between 0 and 20),
  time_sensitivity_score integer not null default 0
    check (time_sensitivity_score between 0 and 15),
  source_reliability_score integer not null default 0
    check (source_reliability_score between 0 and 15),
  capital_requirement_score integer not null default 0
    check (capital_requirement_score between 0 and 10),
  complexity_score integer not null default 0
    check (complexity_score between 0 and 10),
  risk_score integer not null default 0
    check (risk_score between 0 and 5),
  calculated_total integer not null default 0
    check (calculated_total between 0 and 100),
  manual_adjustment integer not null default 0
    check (manual_adjustment between -25 and 25),
  final_total integer not null default 0
    check (final_total between 0 and 100),
  adjustment_reason text,
  adjusted_by uuid references public.profiles (id) on delete set null,
  adjusted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A manual override without a written reason is not auditable.
  constraint adjustment_requires_reason check (
    manual_adjustment = 0 or adjustment_reason is not null
  )
);

select public.attach_updated_at('public.opportunity_score_components');

-- --- Version history --------------------------------------------------------

create table public.opportunity_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  opportunity_id uuid not null
    references public.opportunities (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  record_snapshot jsonb not null,
  change_summary text,
  is_material_change boolean not null default false,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (opportunity_id, version_number)
);

create index opportunity_versions_opportunity_idx
  on public.opportunity_versions (opportunity_id, version_number desc);

-- --- Supporting sources -----------------------------------------------------

create table public.opportunity_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  opportunity_id uuid not null
    references public.opportunities (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete restrict,
  source_url text not null,
  source_title text,
  source_date date,
  is_primary boolean not null default false,
  verification_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (opportunity_id, source_id, source_url)
);

create index opportunity_sources_opportunity_idx
  on public.opportunity_sources (opportunity_id);

-- At most one primary supporting source per opportunity.
create unique index opportunity_sources_one_primary_idx
  on public.opportunity_sources (opportunity_id)
  where is_primary = true;

select public.attach_updated_at('public.opportunity_sources');

-- --- Industry join ----------------------------------------------------------

create table public.opportunity_industries (
  opportunity_id uuid not null
    references public.opportunities (id) on delete cascade,
  industry_id uuid not null references public.industries (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (opportunity_id, industry_id)
);

create index opportunity_industries_industry_idx
  on public.opportunity_industries (industry_id);
