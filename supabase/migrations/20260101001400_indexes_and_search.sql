-- ---------------------------------------------------------------------------
-- 0014 — Query indexes and full-text search (spec 8, 11)
-- ---------------------------------------------------------------------------

-- --- Filter indexes ---------------------------------------------------------

create index opportunities_status_idx on public.opportunities (status);
create index opportunities_workflow_status_idx
  on public.opportunities (workflow_status);
create index opportunities_category_idx on public.opportunities (category);
create index opportunities_subtype_idx on public.opportunities (subtype);
create index opportunities_state_idx on public.opportunities (state_id);
create index opportunities_county_idx on public.opportunities (county_id);
create index opportunities_city_idx on public.opportunities (city_id);
create index opportunities_industry_idx on public.opportunities (industry_id);
create index opportunities_score_idx on public.opportunities (score desc);
create index opportunities_closing_date_idx on public.opportunities (closing_date);
create index opportunities_date_verified_idx
  on public.opportunities (date_verified desc);
create index opportunities_published_at_idx
  on public.opportunities (published_at desc);
create index opportunities_min_access_rank_idx
  on public.opportunities (minimum_access_rank);
create index opportunities_featured_idx
  on public.opportunities (is_featured)
  where is_featured = true;
create index opportunities_expired_idx on public.opportunities (is_expired);
create index opportunities_closing_soon_idx
  on public.opportunities (is_closing_soon)
  where is_closing_soon = true;
create index opportunities_source_idx on public.opportunities (source_id);
create index opportunities_reverification_idx
  on public.opportunities (reverification_due_at)
  where workflow_status = 'published';
create index opportunities_capital_min_idx
  on public.opportunities (capital_required_min);
create index opportunities_estimated_value_max_idx
  on public.opportunities (estimated_value_max desc);

-- The hot path: published, unexpired, unrestricted records ordered by score.
-- A partial composite index keeps the member search fast without dragging the
-- draft backlog through the planner.
create index opportunities_browse_idx
  on public.opportunities (minimum_access_rank, score desc, published_at desc)
  where workflow_status = 'published'
    and is_expired = false
    and is_restricted = false;

create index opportunities_scheduled_idx
  on public.opportunities (scheduled_at)
  where workflow_status = 'scheduled';

-- Geospatial fallback: supports bounding-box narrowing before an exact
-- distance filter, and works whether or not PostGIS installed cleanly.
create index opportunities_lat_long_idx
  on public.opportunities (latitude, longitude)
  where latitude is not null and longitude is not null;

-- --- Full-text search -------------------------------------------------------
--
-- The document spans the opportunity's own prose plus the denormalised names of
-- its county, city and industries (spec 8). Because those live in other tables,
-- the vector is maintained by trigger rather than as a generated column.

create or replace function public.build_opportunity_search_vector(
  target_id uuid
)
returns tsvector
language sql
stable
as $$
  select
    setweight(to_tsvector('english', coalesce(o.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(o.summary, '')), 'B')
    || setweight(
         to_tsvector('english', coalesce(c.name, '') || ' ' || coalesce(ci.name, '')),
         'B'
       )
    || setweight(
         to_tsvector('english', coalesce(string_agg(i.name, ' '), '')),
         'B'
       )
    || setweight(
         to_tsvector('english', coalesce(o.full_analysis::text, '')),
         'C'
       )
    || setweight(
         to_tsvector(
           'english',
           concat_ws(' ',
             coalesce(o.eligibility_summary, ''),
             coalesce(o.risk_summary, ''),
             coalesce(o.recommended_next_action, ''),
             coalesce(o.street_address, ''),
             coalesce(o.subtype, '')
           )
         ),
         'C'
       )
    || setweight(
         to_tsvector('english',
           concat_ws(' ',
             coalesce(s.name, ''),
             coalesce(s.organization_name, ''),
             coalesce(fd.funding_organization, '')
           )
         ),
         'D'
       )
  from public.opportunities o
  left join public.counties c on c.id = o.county_id
  left join public.cities ci on ci.id = o.city_id
  left join public.sources s on s.id = o.source_id
  left join public.funding_details fd on fd.opportunity_id = o.id
  left join public.opportunity_industries oi on oi.opportunity_id = o.id
  left join public.industries i on i.id = oi.industry_id
  where o.id = target_id
  group by o.id, c.name, ci.name, s.name, s.organization_name,
           fd.funding_organization;
$$;

create or replace function public.refresh_opportunity_search_vector()
returns trigger
language plpgsql
as $$
declare
  target uuid;
begin
  target := case tg_table_name
    when 'opportunities' then coalesce(new.id, old.id)
    else coalesce(new.opportunity_id, old.opportunity_id)
  end;

  update public.opportunities
  set search_vector = public.build_opportunity_search_vector(target)
  where id = target;

  return coalesce(new, old);
end;
$$;

-- On the opportunities table the trigger must run AFTER the row exists, and
-- must not re-fire on its own write (guarded by the search_vector comparison).
create trigger opportunities_search_vector_trigger
  after insert or update of
    title, summary, full_analysis, eligibility_summary, risk_summary,
    recommended_next_action, street_address, subtype, county_id, city_id,
    source_id
  on public.opportunities
  for each row execute function public.refresh_opportunity_search_vector();

create trigger opportunity_industries_search_vector_trigger
  after insert or delete on public.opportunity_industries
  for each row execute function public.refresh_opportunity_search_vector();

create trigger funding_details_search_vector_trigger
  after insert or update of funding_organization on public.funding_details
  for each row execute function public.refresh_opportunity_search_vector();

create index opportunities_search_vector_idx
  on public.opportunities using gin (search_vector);

-- Trigram index for "did you mean" title matching on short queries.
create index opportunities_title_trgm_idx
  on public.opportunities using gin (title extensions.gin_trgm_ops);
