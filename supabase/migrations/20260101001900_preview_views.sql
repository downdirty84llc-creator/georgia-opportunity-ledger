-- ---------------------------------------------------------------------------
-- 0019 — Preview projections (spec 13, 14.3 "Locked-state behavior")
--
-- The product needs to show that a record exists to someone whose plan cannot
-- read it — that is the entire upgrade prompt. Row-level security is row-level,
-- not column-level, so relaxing the opportunities policy to make teasers work
-- would hand the full row to anyone holding the anon key.
--
-- Instead the teaser is a separate, deliberately narrow projection. Everything
-- a paying member is buying — the analysis, the financials, the eligibility
-- rules, the source URL — is absent from the view entirely, so there is nothing
-- to leak.
-- ---------------------------------------------------------------------------

create view public.opportunity_previews
with (security_invoker = off) as
  select
    o.id,
    o.slug,
    o.title,
    o.category,
    o.subtype,
    o.status,
    o.score,
    o.score_classification,
    o.minimum_access_rank,
    o.is_featured,
    o.is_closing_soon,
    o.is_expired,
    o.is_sample,
    o.closing_date,
    o.published_at,
    o.date_verified,
    st.abbreviation as state_abbreviation,
    c.name as county_name,
    c.slug as county_slug,
    ci.name as city_name,
    i.name as industry_name,
    i.slug as industry_slug,
    -- A teaser, not the summary. Long enough to judge relevance, short enough
    -- that stringing previews together is not a substitute for a subscription.
    case
      when length(o.summary) <= 180 then o.summary
      else left(o.summary, 177) || '...'
    end as teaser
  from public.opportunities o
  left join public.states st on st.id = o.state_id
  left join public.counties c on c.id = o.county_id
  left join public.cities ci on ci.id = o.city_id
  left join public.industries i on i.id = o.industry_id
  where o.workflow_status = 'published'
    and o.is_restricted = false
    and o.published_at <= now();

comment on view public.opportunity_previews is
  'Teaser projection readable by everyone, including signed-out visitors. '
  'Carries no analysis, financial, eligibility or source-URL fields.';

grant select on public.opportunity_previews to anon, authenticated;

-- Published market indicators at their lowest tier, for the public pricing
-- landing page. Values are withheld: the public page shows what is tracked and
-- how it moved, not the level.
create view public.market_indicator_previews
with (security_invoker = off) as
  select
    mi.id,
    mi.name,
    mi.slug,
    mi.category,
    mi.unit,
    mi.geographic_scope,
    mi.minimum_access_rank,
    mi.display_order,
    latest.reporting_period_end,
    latest.trend_direction,
    latest.percent_change,
    latest.is_sample
  from public.market_indicators mi
  left join lateral (
    select v.reporting_period_end, v.trend_direction, v.percent_change,
           v.is_sample
    from public.market_indicator_values v
    where v.indicator_id = mi.id
    order by v.reporting_period_end desc
    limit 1
  ) latest on true
  where mi.is_active = true;

grant select on public.market_indicator_previews to anon, authenticated;

-- Published report headers, so the archive page can list reports a member
-- cannot yet open.
create view public.report_previews
with (security_invoker = off) as
  select id, title, slug, report_type, reporting_period_start,
         reporting_period_end, minimum_access_rank, published_at, is_sample
  from public.reports
  where status = 'published' and published_at <= now();

grant select on public.report_previews to anon, authenticated;
