/**
 * Search filters, sorting and cursor pagination (spec 10.2, 11).
 *
 * The same filter document is used three ways: parsed from a query string on
 * the search page, stored on `saved_searches.filter_configuration`, and
 * replayed by the saved-search matching job. Keeping one schema means a saved
 * search cannot express something the search page cannot, and vice versa.
 */

import { z } from 'zod';

export const OPPORTUNITY_CATEGORIES = [
  'commercial_property',
  'business_funding',
  'procurement',
  'tax_incentive',
  'market_intelligence',
  'development_project',
  'other',
] as const;

export const OPPORTUNITY_STATUSES = [
  'open',
  'upcoming',
  'closing_soon',
  'under_review',
  'updated',
  'closed',
  'expired',
  'withdrawn',
  'information_only',
] as const;

export const PROPERTY_TYPES = [
  'industrial',
  'warehouse',
  'flex',
  'retail',
  'office',
  'land',
  'mixed_use',
  'hospitality',
  'multifamily',
  'special_purpose',
  'other',
] as const;

export const FUNDING_TYPES = [
  'grant',
  'direct_loan',
  'guaranteed_loan',
  'microloan',
  'tax_credit',
  'tax_incentive',
  'equity_program',
  'competition',
  'government_contract',
  'procurement_opportunity',
  'technical_assistance',
  'workforce_funding',
  'export_assistance',
  'other',
] as const;

export const VERIFICATION_STATUSES = [
  'unverified',
  'pending',
  'verified',
  'reverification_due',
  'failed',
  'retired',
] as const;

export const SORT_OPTIONS = [
  'score_desc',
  'score_asc',
  'closing_soon',
  'newest',
  'recently_updated',
  'value_desc',
  'capital_asc',
  'alphabetical',
] as const;

export type SortOption = (typeof SORT_OPTIONS)[number];

export const SORT_LABELS: Readonly<Record<SortOption, string>> = {
  score_desc: 'Highest score',
  score_asc: 'Lowest score',
  closing_soon: 'Closing soon',
  newest: 'Newest',
  recently_updated: 'Recently updated',
  value_desc: 'Highest estimated value',
  capital_asc: 'Lowest capital requirement',
  alphabetical: 'Alphabetical',
};

/** Filters that require the Detailed tier or better (spec 6, 14.2). */
export const ADVANCED_FILTER_KEYS = [
  'capitalMin',
  'capitalMax',
  'verificationStatus',
  'industryIds',
  'minScore',
  'addedSince',
] as const;

const csvList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.enum(values))])
    .transform((input) =>
      Array.isArray(input)
        ? input
        : input
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).max(20))
    .optional();

const uuidList = z
  .union([z.string(), z.array(z.string().uuid())])
  .transform((input) =>
    Array.isArray(input)
      ? input
      : input
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean),
  )
  .pipe(z.array(z.string().uuid()).max(50))
  .optional();

const boolish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : value === 'true' || value === '1',
  )
  .optional();

const numeric = z.coerce.number().finite().optional();

export const filterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: csvList(OPPORTUNITY_CATEGORIES),
  status: csvList(OPPORTUNITY_STATUSES),
  subtype: z.string().trim().max(80).optional(),
  stateId: z.string().uuid().optional(),
  countyIds: uuidList,
  cityIds: uuidList,
  countySlug: z.string().trim().max(80).optional(),
  propertyTypes: csvList(PROPERTY_TYPES),
  fundingTypes: csvList(FUNDING_TYPES),
  industryIds: uuidList,
  verificationStatus: csvList(VERIFICATION_STATUSES),
  minScore: numeric.pipe(z.number().min(0).max(100).optional()),
  capitalMin: numeric.pipe(z.number().min(0).optional()),
  capitalMax: numeric.pipe(z.number().min(0).optional()),
  deadlineFrom: z.coerce.date().optional(),
  deadlineTo: z.coerce.date().optional(),
  addedSince: z.coerce.date().optional(),
  closingSoon: boolish,
  featured: boolish,
  includeExpired: boolish,
  recentlyUpdated: boolish,
  sort: z.enum(SORT_OPTIONS).default('score_desc'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(500).optional(),
});

export type OpportunityFilters = z.infer<typeof filterSchema>;
export type FilterInput = z.input<typeof filterSchema>;

export function parseFilters(
  params: URLSearchParams | Record<string, unknown>,
): OpportunityFilters {
  const raw =
    params instanceof URLSearchParams
      ? Object.fromEntries(params.entries())
      : params;
  return filterSchema.parse(raw);
}

/** Tolerant parse for stored documents, which may predate a schema change. */
export function parseStoredFilters(raw: unknown): OpportunityFilters {
  const result = filterSchema.safeParse(raw ?? {});
  return result.success ? result.data : filterSchema.parse({});
}

/**
 * Which advanced filters a request is using. The API strips these rather than
 * rejecting the request when the viewer's plan does not include them, so a
 * shared link degrades to a usable search instead of an error page.
 */
export function advancedFiltersInUse(
  filters: OpportunityFilters,
): readonly string[] {
  return ADVANCED_FILTER_KEYS.filter((key) => {
    const value = filters[key];
    return Array.isArray(value) ? value.length > 0 : value !== undefined;
  });
}

export function stripAdvancedFilters(
  filters: OpportunityFilters,
): OpportunityFilters {
  const stripped = { ...filters };
  for (const key of ADVANCED_FILTER_KEYS) {
    delete stripped[key];
  }
  return stripped;
}

// ---------------------------------------------------------------------------
// Sorting and cursors
// ---------------------------------------------------------------------------

export interface SortSpec {
  column: string;
  ascending: boolean;
  /** Rows missing the sort column sort last regardless of direction. */
  nullsFirst: boolean;
}

export function sortSpec(sort: SortOption): SortSpec {
  switch (sort) {
    case 'score_asc':
      return { column: 'score', ascending: true, nullsFirst: false };
    case 'closing_soon':
      return { column: 'closing_date', ascending: true, nullsFirst: false };
    case 'newest':
      return { column: 'published_at', ascending: false, nullsFirst: false };
    case 'recently_updated':
      return { column: 'updated_at', ascending: false, nullsFirst: false };
    case 'value_desc':
      return {
        column: 'estimated_value_max',
        ascending: false,
        nullsFirst: false,
      };
    case 'capital_asc':
      return {
        column: 'capital_required_min',
        ascending: true,
        nullsFirst: false,
      };
    case 'alphabetical':
      return { column: 'title', ascending: true, nullsFirst: false };
    case 'score_desc':
    default:
      return { column: 'score', ascending: false, nullsFirst: false };
  }
}

export interface Cursor {
  /** Value of the sort column on the last row of the previous page. */
  value: string | number | null;
  /** Tie-breaker: ids are unique, so the pair is a total order. */
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(encoded: string | undefined): Cursor | null {
  if (!encoded) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      typeof (parsed as Cursor).id === 'string'
    ) {
      return parsed as Cursor;
    }
    return null;
  } catch {
    // A malformed cursor is a client bug or a truncated URL. Falling back to
    // the first page beats returning an error the member cannot act on.
    return null;
  }
}

/** Human-readable description of the active filters, for the empty state. */
export function describeFilters(filters: OpportunityFilters): string[] {
  const chips: string[] = [];
  if (filters.q) chips.push(`matching “${filters.q}”`);
  if (filters.category?.length) {
    chips.push(`in ${filters.category.length} categor${filters.category.length === 1 ? 'y' : 'ies'}`);
  }
  if (filters.countyIds?.length) {
    chips.push(`in ${filters.countyIds.length} count${filters.countyIds.length === 1 ? 'y' : 'ies'}`);
  }
  if (filters.propertyTypes?.length) {
    chips.push(`${filters.propertyTypes.length} property type(s)`);
  }
  if (filters.fundingTypes?.length) {
    chips.push(`${filters.fundingTypes.length} funding type(s)`);
  }
  if (filters.minScore !== undefined) {
    chips.push(`scoring ${filters.minScore} or higher`);
  }
  if (filters.capitalMax !== undefined) {
    chips.push(`under $${filters.capitalMax.toLocaleString('en-US')} capital`);
  }
  if (filters.closingSoon) chips.push('closing soon');
  return chips;
}
