-- ---------------------------------------------------------------------------
-- 0021 — Opportunity search (spec 10.2, 11)
--
-- Row-level security decides which rows exist for a caller. It cannot decide
-- which *columns* they see, and the product needs exactly that: a Free member
-- must be able to find a Premium record and be told it exists, without reading
-- its analysis or its financials.
--
-- So search is a SECURITY DEFINER function rather than a view. It applies the
-- filters, redacts each column against the caller's effective rank, and returns
-- a keyset cursor. Because the redaction happens here, a caller hitting the RPC
-- directly with the public anon key gets exactly what the application would
-- have shown them.
--
-- Sorting and pagination use a single lexicographically ordered `sort_key`, so
-- one keyset comparison covers all eight sort orders instead of eight separate
-- branches.
-- ---------------------------------------------------------------------------

create or replace function public.search_opportunities(
  p_query text default null,
  p_categories text[] default null,
  p_statuses text[] default null,
  p_subtype text default null,
  p_county_ids uuid[] default null,
  p_city_ids uuid[] default null,
  p_industry_ids uuid[] default null,
  p_property_types text[] default null,
  p_funding_types text[] default null,
  p_verification_statuses text[] default null,
  p_min_score integer default null,
  p_capital_min numeric default null,
  p_capital_max numeric default null,
  p_deadline_from timestamptz default null,
  p_deadline_to timestamptz default null,
  p_added_since timestamptz default null,
  p_closing_soon boolean default null,
  p_featured boolean default null,
  p_include_expired boolean default false,
  p_sort text default 'score_desc',
  p_limit integer default 20,
  p_cursor_key text default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  slug text,
  title text,
  category public.opportunity_category,
  subtype text,
  teaser text,
  summary text,
  score integer,
  score_classification public.score_classification,
  score_explanation text,
  status public.opportunity_status,
  county_name text,
  county_slug text,
  city_name text,
  state_abbreviation text,
  industry_name text,
  property_type public.property_type,
  funding_type public.funding_type,
  estimated_value_min numeric,
  estimated_value_max numeric,
  capital_required_min numeric,
  capital_required_max numeric,
  closing_date timestamptz,
  is_closing_soon boolean,
  is_expired boolean,
  is_featured boolean,
  is_sample boolean,
  verification_status public.verification_status,
  date_verified date,
  published_at timestamptz,
  updated_at timestamptz,
  minimum_access_rank integer,
  is_locked boolean,
  sort_key text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  viewer_rank integer := public.my_access_rank();
  page_size integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  ascending boolean;
begin
  ascending := p_sort in ('score_asc', 'closing_soon', 'capital_asc', 'alphabetical');

  return query
  with filtered as (
    select
      o.*,
      c.name as county_name_v,
      c.slug as county_slug_v,
      ci.name as city_name_v,
      st.abbreviation as state_abbreviation_v,
      ind.name as industry_name_v,
      pd.property_type as property_type_v,
      fd.funding_type as funding_type_v,
      -- One orderable text key per sort option. Numbers are zero-padded and
      -- timestamps rendered as sortable strings so a single tuple comparison
      -- implements the cursor for every sort order.
      case p_sort
        when 'score_asc' then lpad(o.score::text, 3, '0')
        when 'score_desc' then lpad(o.score::text, 3, '0')
        when 'closing_soon' then
          coalesce(to_char(o.closing_date at time zone 'UTC',
                           'YYYYMMDDHH24MISS'), '99999999999999')
        when 'newest' then
          coalesce(to_char(o.published_at at time zone 'UTC',
                           'YYYYMMDDHH24MISS'), '00000000000000')
        when 'recently_updated' then
          to_char(o.updated_at at time zone 'UTC', 'YYYYMMDDHH24MISS')
        when 'value_desc' then
          lpad(coalesce(round(o.estimated_value_max), 0)::text, 16, '0')
        when 'capital_asc' then
          lpad(coalesce(round(o.capital_required_min), 999999999999)::text, 16, '0')
        when 'alphabetical' then lower(o.title)
        else lpad(o.score::text, 3, '0')
      end as sort_key_v
    from public.opportunities o
    left join public.counties c on c.id = o.county_id
    left join public.cities ci on ci.id = o.city_id
    left join public.states st on st.id = o.state_id
    left join public.industries ind on ind.id = o.industry_id
    left join public.property_details pd on pd.opportunity_id = o.id
    left join public.funding_details fd on fd.opportunity_id = o.id
    where o.workflow_status = 'published'
      and o.is_restricted = false
      and o.published_at <= now()
      and (p_include_expired is true or o.is_expired = false)
      and (p_query is null or p_query = ''
           or o.search_vector @@ websearch_to_tsquery('english', p_query))
      and (p_categories is null
           or o.category::text = any(p_categories))
      and (p_statuses is null or o.status::text = any(p_statuses))
      and (p_subtype is null or o.subtype ilike '%' || p_subtype || '%')
      and (p_county_ids is null or o.county_id = any(p_county_ids))
      and (p_city_ids is null or o.city_id = any(p_city_ids))
      and (p_property_types is null
           or pd.property_type::text = any(p_property_types))
      and (p_funding_types is null
           or fd.funding_type::text = any(p_funding_types))
      and (p_verification_statuses is null
           or o.verification_status::text = any(p_verification_statuses))
      and (p_min_score is null or o.score >= p_min_score)
      -- An unresearched capital requirement is not excluded by a ceiling:
      -- unknown is not the same as unaffordable.
      and (p_capital_max is null or o.capital_required_min is null
           or o.capital_required_min <= p_capital_max)
      and (p_capital_min is null or o.capital_required_min is null
           or o.capital_required_min >= p_capital_min)
      and (p_deadline_from is null or o.closing_date >= p_deadline_from)
      and (p_deadline_to is null or o.closing_date <= p_deadline_to)
      and (p_added_since is null or o.published_at >= p_added_since)
      and (p_closing_soon is not true or o.is_closing_soon = true)
      and (p_featured is not true or o.is_featured = true)
      and (
        p_industry_ids is null
        or o.industry_id = any(p_industry_ids)
        or exists (
          select 1 from public.opportunity_industries oi
          where oi.opportunity_id = o.id and oi.industry_id = any(p_industry_ids)
        )
      )
  ),
  counted as (select count(*) as n from filtered),
  paged as (
    select f.*
    from filtered f
    where p_cursor_key is null
       or p_cursor_id is null
       or (
         case
           when ascending then (f.sort_key_v, f.id) > (p_cursor_key, p_cursor_id)
           else (f.sort_key_v, f.id) < (p_cursor_key, p_cursor_id)
         end
       )
    order by
      case when ascending then f.sort_key_v end asc,
      case when not ascending then f.sort_key_v end desc,
      case when ascending then f.id end asc,
      case when not ascending then f.id end desc
    limit page_size
  )
  select
    p.id,
    p.slug,
    p.title,
    p.category,
    p.subtype,
    case
      when length(p.summary) <= 180 then p.summary
      else left(p.summary, 177) || '...'
    end as teaser,
    -- Summary and below require the record's own rank, and a plan that renders
    -- more than a teaser (rank 10 = Weekly).
    case when viewer_rank >= p.minimum_access_rank and viewer_rank >= 10
         then p.summary end as summary,
    p.score,
    p.score_classification,
    -- Score explanations are a Detailed capability (rank 20).
    case when viewer_rank >= p.minimum_access_rank and viewer_rank >= 20
         then p.score_explanation end as score_explanation,
    p.status,
    p.county_name_v,
    p.county_slug_v,
    p.city_name_v,
    p.state_abbreviation_v,
    p.industry_name_v,
    p.property_type_v,
    p.funding_type_v,
    case when viewer_rank >= p.minimum_access_rank and viewer_rank >= 10
         then p.estimated_value_min end,
    case when viewer_rank >= p.minimum_access_rank and viewer_rank >= 10
         then p.estimated_value_max end,
    case when viewer_rank >= p.minimum_access_rank and viewer_rank >= 10
         then p.capital_required_min end,
    case when viewer_rank >= p.minimum_access_rank and viewer_rank >= 10
         then p.capital_required_max end,
    p.closing_date,
    p.is_closing_soon,
    p.is_expired,
    p.is_featured,
    p.is_sample,
    p.verification_status,
    p.date_verified,
    p.published_at,
    p.updated_at,
    p.minimum_access_rank,
    (viewer_rank < p.minimum_access_rank) as is_locked,
    p.sort_key_v,
    (select n from counted) as total_count
  from paged p
  order by
    case when ascending then p.sort_key_v end asc,
    case when not ascending then p.sort_key_v end desc,
    case when ascending then p.id end asc,
    case when not ascending then p.id end desc;
end;
$$;

grant execute on function public.search_opportunities(
  text, text[], text[], text, uuid[], uuid[], uuid[], text[], text[], text[],
  integer, numeric, numeric, timestamptz, timestamptz, timestamptz, boolean,
  boolean, boolean, text, integer, text, uuid
) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Facet counts for the search sidebar. Cheap enough to run alongside a search
-- because the same partial index serves both.
-- ---------------------------------------------------------------------------

create or replace function public.opportunity_facets()
returns table (
  facet text,
  key text,
  label text,
  count bigint
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with visible as (
    select o.*, c.name as county_name, c.slug as county_slug
    from public.opportunities o
    left join public.counties c on c.id = o.county_id
    where o.workflow_status = 'published'
      and o.is_restricted = false
      and o.is_expired = false
      and o.published_at <= now()
  )
  select 'category', v.category::text, replace(initcap(replace(v.category::text, '_', ' ')), ' And ', ' and '), count(*)
  from visible v group by v.category
  union all
  select 'county', v.county_slug, v.county_name, count(*)
  from visible v where v.county_slug is not null
  group by v.county_slug, v.county_name
  union all
  select 'status', v.status::text, initcap(replace(v.status::text, '_', ' ')), count(*)
  from visible v group by v.status
  union all
  select 'classification', v.score_classification::text,
         initcap(replace(v.score_classification::text, '_', ' ')), count(*)
  from visible v group by v.score_classification;
$$;

grant execute on function public.opportunity_facets()
  to anon, authenticated, service_role;
