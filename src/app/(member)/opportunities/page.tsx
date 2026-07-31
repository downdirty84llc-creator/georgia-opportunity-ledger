import type { Metadata } from 'next';
import Link from 'next/link';

import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import { SaveSearchButton } from '@/components/opportunities/save-search-button';
import { ButtonLink, EmptyState, Pill, cx } from '@/components/ui/primitives';
import {
  canExportCsv,
  canSaveSearch,
  canUseAdvancedFilters,
} from '@/lib/access/entitlements';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { titleCase } from '@/lib/format';
import { loadFacets, searchOpportunities } from '@/lib/opportunities/query';
import {
  SORT_LABELS,
  SORT_OPTIONS,
  describeFilters,
  filterSchema,
} from '@/lib/search/filters';
import type { ScoreClassification } from '@/lib/scoring/score';

export const metadata: Metadata = { title: 'Opportunities' };
export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function flatten(
  params: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') flat[key] = value;
    else if (Array.isArray(value) && value[0] !== undefined)
      flat[key] = value.join(',');
  }
  return flat;
}

export default async function OpportunitiesPage({ searchParams }: PageProps) {
  const rawParams = flatten(await searchParams);
  const parsed = filterSchema.safeParse(rawParams);
  const filters = parsed.success ? parsed.data : filterSchema.parse({});

  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const [result, facets] = await Promise.all([
    searchOpportunities(supabase, viewer, filters),
    loadFacets(supabase),
  ]);

  const advanced = canUseAdvancedFilters(viewer);
  const exportDecision = canExportCsv(viewer);
  const saveSearchDecision = canSaveSearch(viewer, 0);
  const activeChips = describeFilters(result.appliedFilters);

  const buildHref = (overrides: Record<string, string | undefined>) => {
    const next = new URLSearchParams(rawParams);
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) next.delete(key);
      else next.set(key, value);
    }
    // Changing a filter resets to page one; paging keeps the cursor it was
    // given.
    if (!('cursor' in overrides)) next.delete('cursor');
    const query = next.toString();
    return query ? `/opportunities?${query}` : '/opportunities';
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl">Opportunities</h1>
          <p className="mt-1 text-sm text-ink-600">
            {result.totalCount.toLocaleString('en-US')}{' '}
            {result.totalCount === 1 ? 'record' : 'records'} match
            {result.totalCount === 1 ? 'es' : ''} your search.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SaveSearchButton
            filters={result.appliedFilters}
            allowed={saveSearchDecision.allowed}
            deniedMessage={saveSearchDecision.message}
          />
          {exportDecision.allowed ? (
            <ButtonLink href="/saved" variant="secondary">
              Export from saved
            </ButtonLink>
          ) : (
            <span className="inline-flex items-center rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-500">
              CSV export is a Premium feature
            </span>
          )}
        </div>
      </div>

      {result.droppedFilters.length > 0 ? (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">
            Some filters were not applied.
          </strong>{' '}
          {result.droppedFilters.map((f) => titleCase(f)).join(', ')}{' '}
          {result.droppedFilters.length === 1 ? 'is an' : 'are'} advanced{' '}
          {result.droppedFilters.length === 1 ? 'filter' : 'filters'}, included
          with Detailed Intelligence.{' '}
          <Link href="/pricing" className="font-medium underline">
            Compare plans
          </Link>
          .
        </p>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[260px,1fr]">
        {/* Filters. A plain GET form: works without JavaScript, is
            bookmarkable, and every filter state has a real URL. */}
        <form
          method="get"
          action="/opportunities"
          className="surface h-fit p-4 lg:sticky lg:top-6"
        >
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
            Filters
          </h2>

          <label className="mt-4 block text-sm font-medium" htmlFor="q">
            Keyword
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.q ?? ''}
            placeholder="Warehouse, tax credit, Savannah…"
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
          />

          <fieldset className="mt-5">
            <legend className="text-sm font-medium">Category</legend>
            <div className="mt-2 space-y-1.5">
              {(facets.category ?? []).map((facet) => (
                <label
                  key={facet.key}
                  className="flex items-center gap-2 text-sm text-ink-700"
                >
                  <input
                    type="checkbox"
                    name="category"
                    value={facet.key}
                    defaultChecked={filters.category?.includes(
                      facet.key as never,
                    )}
                    className="rounded border-ink-300"
                  />
                  <span className="flex-1">{facet.label}</span>
                  <span className="text-xs tabular-nums text-ink-500">
                    {facet.count}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-5 block text-sm font-medium" htmlFor="minScore">
            Minimum score{' '}
            {!advanced.allowed ? (
              <span className="font-normal text-ink-500">(Detailed)</span>
            ) : null}
          </label>
          <input
            id="minScore"
            name="minScore"
            type="number"
            min={0}
            max={100}
            step={5}
            disabled={!advanced.allowed}
            defaultValue={filters.minScore ?? ''}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm disabled:bg-ink-50 disabled:text-ink-400"
          />

          <label
            className="mt-4 block text-sm font-medium"
            htmlFor="capitalMax"
          >
            Capital available{' '}
            {!advanced.allowed ? (
              <span className="font-normal text-ink-500">(Detailed)</span>
            ) : null}
          </label>
          <input
            id="capitalMax"
            name="capitalMax"
            type="number"
            min={0}
            step={10000}
            disabled={!advanced.allowed}
            defaultValue={filters.capitalMax ?? ''}
            placeholder="250000"
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm disabled:bg-ink-50 disabled:text-ink-400"
          />

          <label className="mt-5 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="closingSoon"
              value="true"
              defaultChecked={filters.closingSoon}
              className="rounded border-ink-300"
            />
            Closing within 14 days
          </label>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="includeExpired"
              value="true"
              defaultChecked={filters.includeExpired}
              className="rounded border-ink-300"
            />
            Include closed records
          </label>

          <label className="mt-5 block text-sm font-medium" htmlFor="sort">
            Sort by
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={filters.sort}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {SORT_LABELS[option]}
              </option>
            ))}
          </select>

          <label className="mt-4 block text-sm font-medium" htmlFor="limit">
            Results per page
          </label>
          <select
            id="limit"
            name="limit"
            defaultValue={String(filters.limit)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
          >
            {[20, 50, 100]
              .filter(
                (size) => viewer.isStaff || size <= viewer.features.maxPageSize,
              )
              .map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
          </select>

          <div className="mt-6 flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800"
            >
              Apply
            </button>
            <Link
              href="/opportunities"
              className="rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium hover:bg-ink-50"
            >
              Clear
            </Link>
          </div>
        </form>

        <div>
          {activeChips.length > 0 ? (
            <ul className="mb-4 flex flex-wrap gap-2">
              {activeChips.map((chip) => (
                <li key={chip}>
                  <Pill>{chip}</Pill>
                </li>
              ))}
            </ul>
          ) : null}

          {result.rows.length === 0 ? (
            <EmptyState
              title="No records match this search"
              description="Nothing in the published ledger matches every filter you have set. Removing the narrowest one — usually the keyword or the capital ceiling — is the fastest way back to results."
            >
              <ButtonLink href="/opportunities" variant="secondary">
                Clear all filters
              </ButtonLink>
              {saveSearchDecision.allowed ? (
                <SaveSearchButton
                  filters={result.appliedFilters}
                  allowed
                  deniedMessage=""
                  label="Save this search and get told when something matches"
                />
              ) : (
                <ButtonLink href="/pricing">
                  Get alerted when something matches
                </ButtonLink>
              )}
            </EmptyState>
          ) : (
            <>
              <ul className="grid gap-4 md:grid-cols-2">
                {result.rows.map((row) => (
                  <li key={row.id}>
                    <OpportunityCard
                      opportunity={{
                        id: row.id,
                        slug: row.slug,
                        title: row.title,
                        category: row.category,
                        subtype: row.subtype,
                        teaser: row.teaser,
                        summary: row.summary,
                        score: row.score,
                        classification:
                          row.score_classification as ScoreClassification,
                        county: row.county_name,
                        city: row.city_name,
                        closingDate: row.closing_date,
                        isClosingSoon: row.is_closing_soon,
                        isExpired: row.is_expired,
                        isSample: row.is_sample,
                        isLocked: row.is_locked,
                        capitalRequiredMin: row.capital_required_min,
                        capitalRequiredMax: row.capital_required_max,
                        estimatedValueMin: row.estimated_value_min,
                        estimatedValueMax: row.estimated_value_max,
                        verificationStatus: row.verification_status,
                        dateVerified: row.date_verified,
                      }}
                    />
                  </li>
                ))}
              </ul>

              <nav
                aria-label="Pagination"
                className="mt-8 flex items-center justify-between gap-4"
              >
                <p className="text-sm text-ink-600">
                  Showing {result.rows.length} of{' '}
                  {result.totalCount.toLocaleString('en-US')}
                </p>
                {result.nextCursor ? (
                  <Link
                    href={buildHref({ cursor: result.nextCursor })}
                    className={cx(
                      'rounded-lg border border-ink-300 px-4 py-2 text-sm font-medium',
                      'hover:bg-ink-50',
                    )}
                  >
                    Next page
                  </Link>
                ) : null}
              </nav>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
