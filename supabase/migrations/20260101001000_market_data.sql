-- ---------------------------------------------------------------------------
-- 0010 — Market indicators and observations (spec 7.9)
-- ---------------------------------------------------------------------------

create table public.market_indicators (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  category public.market_category not null,
  description text,
  unit text not null,
  source_id uuid references public.sources (id) on delete set null,
  geographic_scope text not null default 'Georgia',
  update_frequency public.update_frequency not null default 'monthly',
  minimum_access_rank integer not null default 0
    check (minimum_access_rank >= 0),
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index market_indicators_category_idx on public.market_indicators (category);
create index market_indicators_rank_idx
  on public.market_indicators (minimum_access_rank);

select public.attach_updated_at('public.market_indicators');

create table public.market_indicator_values (
  id uuid primary key default extensions.gen_random_uuid(),
  indicator_id uuid not null
    references public.market_indicators (id) on delete cascade,
  reporting_period_start date not null,
  reporting_period_end date not null,
  value numeric(16, 4) not null,
  previous_value numeric(16, 4),
  percent_change numeric(8, 3),
  trend_direction public.trend_direction,
  interpretation text,
  source_url text,
  verified_at timestamptz,
  -- Illustrative observations loaded by the seeder. Never mix with verified
  -- production observations in a published pricing report (spec 27).
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (indicator_id, reporting_period_start, reporting_period_end),
  constraint reporting_period_ordered
    check (reporting_period_start <= reporting_period_end)
);

create index market_indicator_values_indicator_period_idx
  on public.market_indicator_values (indicator_id, reporting_period_end desc);

select public.attach_updated_at('public.market_indicator_values');

-- Derive percent change and direction from the supplied previous value so the
-- dashboard never has to trust hand-entered arithmetic.
create or replace function public.derive_indicator_movement()
returns trigger
language plpgsql
as $$
begin
  if new.previous_value is null then
    select miv.value into new.previous_value
    from public.market_indicator_values miv
    where miv.indicator_id = new.indicator_id
      and miv.reporting_period_end < new.reporting_period_start
    order by miv.reporting_period_end desc
    limit 1;
  end if;

  if new.previous_value is not null and new.previous_value <> 0 then
    new.percent_change :=
      round(((new.value - new.previous_value) / abs(new.previous_value)) * 100, 3);
  end if;

  if new.percent_change is not null then
    new.trend_direction := case
      when new.percent_change > 0.5 then 'up'::public.trend_direction
      when new.percent_change < -0.5 then 'down'::public.trend_direction
      else 'flat'::public.trend_direction
    end;
  end if;

  return new;
end;
$$;

create trigger derive_indicator_movement_trigger
  before insert or update on public.market_indicator_values
  for each row execute function public.derive_indicator_movement();
