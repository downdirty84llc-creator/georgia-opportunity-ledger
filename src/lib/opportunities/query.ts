import type { SupabaseClient } from '@supabase/supabase-js';

import type { Viewer } from '@/lib/access/entitlements';
import { canUseAdvancedFilters, resolvePageSize } from '@/lib/access/entitlements';
import {
  advancedFiltersInUse,
  decodeCursor,
  encodeCursor,
  stripAdvancedFilters,
  type OpportunityFilters,
} from '@/lib/search/filters';

/** One row as returned by `public.search_opportunities`. */
export interface OpportunitySearchRow {
  id: string;
  slug: string;
  title: string;
  category: string;
  subtype: string;
  teaser: string;
  summary: string | null;
  score: number;
  score_classification: string;
  score_explanation: string | null;
  status: string;
  county_name: string | null;
  county_slug: string | null;
  city_name: string | null;
  state_abbreviation: string | null;
  industry_name: string | null;
  property_type: string | null;
  funding_type: string | null;
  estimated_value_min: number | null;
  estimated_value_max: number | null;
  capital_required_min: number | null;
  capital_required_max: number | null;
  closing_date: string | null;
  is_closing_soon: boolean;
  is_expired: boolean;
  is_featured: boolean;
  is_sample: boolean;
  verification_status: string;
  date_verified: string | null;
  published_at: string | null;
  updated_at: string;
  minimum_access_rank: number;
  is_locked: boolean;
  sort_key: string;
  total_count: number;
}

export interface OpportunitySearchResult {
  rows: OpportunitySearchRow[];
  totalCount: number;
  nextCursor: string | null;
  hasMore: boolean;
  /** Advanced filters removed because the viewer's plan excludes them. */
  droppedFilters: readonly string[];
  appliedFilters: OpportunityFilters;
}

function emptyToNull<T>(list: readonly T[] | undefined): T[] | null {
  return list && list.length > 0 ? [...list] : null;
}

/**
 * Runs a search on the caller's behalf.
 *
 * Advanced filters are stripped rather than rejected when the viewer's plan
 * does not include them, so a link shared from a Premium member to a Free one
 * still returns a usable result set. What was dropped is reported back so the
 * UI can say so and offer the upgrade.
 */
export async function searchOpportunities(
  supabase: SupabaseClient,
  viewer: Viewer,
  filters: OpportunityFilters,
): Promise<OpportunitySearchResult> {
  const advanced = advancedFiltersInUse(filters);
  const advancedAllowed = canUseAdvancedFilters(viewer).allowed;
  const effective =
    advancedAllowed || advanced.length === 0
      ? filters
      : stripAdvancedFilters(filters);
  const droppedFilters = advancedAllowed ? [] : advanced;

  const limit = resolvePageSize(viewer, filters.limit);
  const cursor = decodeCursor(filters.cursor);

  const { data, error } = await supabase.rpc('search_opportunities', {
    p_query: effective.q ?? null,
    p_categories: emptyToNull(effective.category),
    p_statuses: emptyToNull(effective.status),
    p_subtype: effective.subtype ?? null,
    p_county_ids: emptyToNull(effective.countyIds),
    p_city_ids: emptyToNull(effective.cityIds),
    p_industry_ids: emptyToNull(effective.industryIds),
    p_property_types: emptyToNull(effective.propertyTypes),
    p_funding_types: emptyToNull(effective.fundingTypes),
    p_verification_statuses: emptyToNull(effective.verificationStatus),
    p_min_score: effective.minScore ?? null,
    p_capital_min: effective.capitalMin ?? null,
    p_capital_max: effective.capitalMax ?? null,
    p_deadline_from: effective.deadlineFrom?.toISOString() ?? null,
    p_deadline_to: effective.deadlineTo?.toISOString() ?? null,
    p_added_since: effective.addedSince?.toISOString() ?? null,
    p_closing_soon: effective.closingSoon ?? null,
    p_featured: effective.featured ?? null,
    p_include_expired: effective.includeExpired ?? false,
    p_sort: effective.sort,
    // Fetch one extra row to learn whether another page exists without a
    // second count query.
    p_limit: limit + 1,
    p_cursor_key: cursor?.value != null ? String(cursor.value) : null,
    p_cursor_id: cursor?.id ?? null,
  });

  if (error) {
    throw new Error(`Opportunity search failed: ${error.message}`);
  }

  const allRows = (data ?? []) as OpportunitySearchRow[];
  const hasMore = allRows.length > limit;
  const rows = hasMore ? allRows.slice(0, limit) : allRows;
  const last = rows[rows.length - 1];

  return {
    rows,
    totalCount: rows[0]?.total_count ?? 0,
    hasMore,
    nextCursor:
      hasMore && last ? encodeCursor({ value: last.sort_key, id: last.id }) : null,
    droppedFilters,
    appliedFilters: effective,
  };
}

export interface FacetRow {
  facet: string;
  key: string;
  label: string;
  count: number;
}

export async function loadFacets(
  supabase: SupabaseClient,
): Promise<Record<string, FacetRow[]>> {
  const { data, error } = await supabase.rpc('opportunity_facets');
  if (error) {
    // Facets are decoration. A failure here should not take down search.
    console.error('[search] facet load failed', error.message);
    return {};
  }
  const grouped: Record<string, FacetRow[]> = {};
  for (const row of (data ?? []) as FacetRow[]) {
    const bucket = grouped[row.facet] ?? [];
    bucket.push(row);
    grouped[row.facet] = bucket;
  }
  for (const key of Object.keys(grouped)) {
    grouped[key]?.sort((a, b) => b.count - a.count);
  }
  return grouped;
}

/**
 * Full detail for one record, honouring the caller's row-level security.
 *
 * Returns `null` when the record is absent *or* the caller's rank is too low —
 * the two are deliberately indistinguishable to the client so that record
 * existence cannot be probed by id (spec 26, "ID enumeration").
 */
export async function loadOpportunityDetail(
  supabase: SupabaseClient,
  idOrSlug: string,
) {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idOrSlug,
    );

  const query = supabase
    .from('opportunities')
    .select(
      `
      *,
      counties ( id, name, slug ),
      cities ( id, name, slug ),
      states ( id, name, abbreviation ),
      industries ( id, name, slug ),
      property_details ( * ),
      funding_details ( * ),
      opportunity_score_components ( * ),
      opportunity_sources ( source_url, source_title, source_date, is_primary,
                            verification_notes ),
      opportunity_industries ( industry_id, industries ( id, name, slug ) )
    `,
    )
    .limit(1);

  const { data, error } = isUuid
    ? await query.eq('id', idOrSlug).maybeSingle()
    : await query.eq('slug', idOrSlug).maybeSingle();

  if (error) throw new Error(`Opportunity load failed: ${error.message}`);
  if (!data) return null;

  // The `sources` table is staff-only — it carries contact details and internal
  // notes — so provenance for members comes from the narrowed view instead of
  // an embedded join.
  const record = data as Record<string, unknown>;
  if (record.source_id) {
    const { data: source } = await supabase
      .from('public_sources')
      .select('name, organization_name, source_type, website_url, reliability_score')
      .eq('id', record.source_id as string)
      .maybeSingle();
    record.sources = source ?? null;
  }

  return record;
}
