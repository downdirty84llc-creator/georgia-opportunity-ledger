-- ---------------------------------------------------------------------------
-- 0009 — Category-specific detail tables (spec 7.6, 7.7)
-- ---------------------------------------------------------------------------

create table public.property_details (
  id uuid primary key default extensions.gen_random_uuid(),
  opportunity_id uuid not null unique
    references public.opportunities (id) on delete cascade,
  property_type public.property_type not null,
  sale_type public.sale_type not null,
  parcel_number text,
  asking_price numeric(14, 2),
  starting_bid numeric(14, 2),
  assessed_value numeric(14, 2),
  estimated_taxes numeric(14, 2),
  building_size_sqft numeric(12, 2),
  lot_size_acres numeric(12, 4),
  zoning text,
  current_use text,
  occupancy_status text,
  year_built integer check (year_built is null
    or year_built between 1700 and extract(year from now())::integer + 5),
  parking_spaces integer check (parking_spaces is null or parking_spaces >= 0),
  utilities jsonb not null default '{}'::jsonb,
  ownership_type text,
  inspection_date timestamptz,
  registration_deadline timestamptz,
  auction_date timestamptz,
  known_liens text,
  title_notes text,
  due_diligence_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index property_details_type_idx on public.property_details (property_type);
create index property_details_sale_type_idx on public.property_details (sale_type);
create index property_details_auction_date_idx
  on public.property_details (auction_date)
  where auction_date is not null;

select public.attach_updated_at('public.property_details');

create table public.funding_details (
  id uuid primary key default extensions.gen_random_uuid(),
  opportunity_id uuid not null unique
    references public.opportunities (id) on delete cascade,
  funding_type public.funding_type not null,
  funding_organization text,
  minimum_amount numeric(14, 2),
  maximum_amount numeric(14, 2),
  owner_contribution_percent numeric(5, 2)
    check (owner_contribution_percent is null
           or owner_contribution_percent between 0 and 100),
  interest_rate_notes text,
  term_notes text,
  collateral_notes text,
  credit_notes text,
  minimum_revenue numeric(14, 2),
  maximum_revenue numeric(14, 2),
  minimum_employees integer check (minimum_employees is null
    or minimum_employees >= 0),
  maximum_employees integer check (maximum_employees is null
    or maximum_employees >= 0),
  minimum_time_in_business_months integer
    check (minimum_time_in_business_months is null
           or minimum_time_in_business_months >= 0),
  permitted_uses jsonb not null default '[]'::jsonb,
  prohibited_uses jsonb not null default '[]'::jsonb,
  application_complexity public.application_complexity
    not null default 'moderate',
  estimated_decision_timeline text,
  application_url text,
  application_open_date timestamptz,
  application_deadline timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funding_amount_ordered check (
    minimum_amount is null or maximum_amount is null
    or minimum_amount <= maximum_amount
  ),
  constraint funding_revenue_ordered check (
    minimum_revenue is null or maximum_revenue is null
    or minimum_revenue <= maximum_revenue
  ),
  constraint funding_employees_ordered check (
    minimum_employees is null or maximum_employees is null
    or minimum_employees <= maximum_employees
  )
);

create index funding_details_type_idx on public.funding_details (funding_type);
create index funding_details_deadline_idx
  on public.funding_details (application_deadline)
  where application_deadline is not null;

select public.attach_updated_at('public.funding_details');
