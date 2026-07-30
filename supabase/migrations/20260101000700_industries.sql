-- ---------------------------------------------------------------------------
-- 0007 — Industry taxonomy (spec 7.8)
-- ---------------------------------------------------------------------------

create table public.industries (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  parent_industry_id uuid references public.industries (id) on delete set null,
  description text,
  naics_prefix text,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint industry_not_own_parent check (id <> parent_industry_id)
);

create index industries_parent_idx on public.industries (parent_industry_id);
create index industries_name_trgm_idx
  on public.industries using gin (name extensions.gin_trgm_ops);

select public.attach_updated_at('public.industries');
