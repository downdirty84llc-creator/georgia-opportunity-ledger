/**
 * Access ranks and plan entitlements.
 *
 * A rank is a single integer that answers "how much of a record may this
 * account read". Ranks are compared with `>=` against an opportunity's
 * `minimum_access_rank`, which is why they are spaced ten apart: a tier can be
 * inserted between two existing ones without renumbering published content.
 *
 * Staff sit above every plan so they can preview any tier. Staff *permissions*
 * — publishing, refunding, suspending — are role checks and never rank checks
 * (spec 9, "Administrator access rule").
 */

export const ACCESS_RANK = {
  free: 0,
  weekly: 10,
  detailed: 20,
  premium: 30,
  /** Mirrors public.staff_access_rank() in the database. */
  staff: 100,
} as const;

export type PlanCode = 'free' | 'weekly' | 'detailed' | 'premium';

export const PLAN_CODES: readonly PlanCode[] = [
  'free',
  'weekly',
  'detailed',
  'premium',
];

export type OpportunityDetailLevel = 'preview' | 'summary' | 'complete';
export type ReportArchiveLevel = 'limited' | 'full';
export type PricingDashboardLevel = 'preview' | 'complete';

/**
 * The entitlement document stored on `subscription_plans.feature_configuration`.
 * A `null` limit means unlimited; `0` means the feature is unavailable.
 */
export interface PlanFeatures {
  savedOpportunityLimit: number | null;
  savedSearchLimit: number | null;
  csvExport: boolean;
  immediateAlerts: boolean;
  opportunityDetail: OpportunityDetailLevel;
  reportArchive: ReportArchiveLevel;
  pricingDashboard: PricingDashboardLevel;
  advancedFilters: boolean;
  deadlineCalendar: boolean;
  weeklyReports: boolean;
  weeklyReminders: boolean;
  customAlertPreferences: boolean;
  premiumBriefing: boolean;
  completeDatabaseAccess: boolean;
  maxPageSize: number;
}

/**
 * Compiled-in copy of the plan matrix from spec section 6.
 *
 * The database is authoritative at runtime — an operator can adjust a limit
 * without a deploy — but these defaults let the application boot, render
 * pricing, and enforce limits when the plan row has not loaded yet. The
 * `tests/unit/access/plan-parity.test.ts` suite checks this table against
 * `supabase/seed.sql` so the two cannot drift silently.
 */
export const PLAN_FEATURE_DEFAULTS: Readonly<Record<PlanCode, PlanFeatures>> = {
  free: {
    savedOpportunityLimit: 1,
    savedSearchLimit: 0,
    csvExport: false,
    immediateAlerts: false,
    opportunityDetail: 'preview',
    reportArchive: 'limited',
    pricingDashboard: 'preview',
    advancedFilters: false,
    deadlineCalendar: false,
    weeklyReports: false,
    weeklyReminders: false,
    customAlertPreferences: false,
    premiumBriefing: false,
    completeDatabaseAccess: false,
    maxPageSize: 20,
  },
  weekly: {
    savedOpportunityLimit: 25,
    savedSearchLimit: 0,
    csvExport: false,
    immediateAlerts: false,
    opportunityDetail: 'summary',
    reportArchive: 'limited',
    pricingDashboard: 'preview',
    advancedFilters: false,
    deadlineCalendar: true,
    weeklyReports: true,
    weeklyReminders: false,
    customAlertPreferences: false,
    premiumBriefing: false,
    completeDatabaseAccess: false,
    maxPageSize: 50,
  },
  detailed: {
    savedOpportunityLimit: null,
    savedSearchLimit: 0,
    csvExport: false,
    immediateAlerts: false,
    opportunityDetail: 'complete',
    reportArchive: 'full',
    pricingDashboard: 'complete',
    advancedFilters: true,
    deadlineCalendar: true,
    weeklyReports: true,
    weeklyReminders: true,
    customAlertPreferences: false,
    premiumBriefing: false,
    completeDatabaseAccess: false,
    maxPageSize: 50,
  },
  premium: {
    savedOpportunityLimit: null,
    savedSearchLimit: null,
    csvExport: true,
    immediateAlerts: true,
    opportunityDetail: 'complete',
    reportArchive: 'full',
    pricingDashboard: 'complete',
    advancedFilters: true,
    deadlineCalendar: true,
    weeklyReports: true,
    weeklyReminders: true,
    customAlertPreferences: true,
    premiumBriefing: true,
    completeDatabaseAccess: true,
    maxPageSize: 100,
  },
};

export const PLAN_RANK: Readonly<Record<PlanCode, number>> = {
  free: ACCESS_RANK.free,
  weekly: ACCESS_RANK.weekly,
  detailed: ACCESS_RANK.detailed,
  premium: ACCESS_RANK.premium,
};

/**
 * The plan a rank corresponds to, rounding down. Staff ranks resolve to the
 * highest plan because staff previews should show the richest tier.
 */
export function planCodeForRank(rank: number): PlanCode {
  if (rank >= ACCESS_RANK.premium) return 'premium';
  if (rank >= ACCESS_RANK.detailed) return 'detailed';
  if (rank >= ACCESS_RANK.weekly) return 'weekly';
  return 'free';
}

export function featuresForRank(rank: number): PlanFeatures {
  return PLAN_FEATURE_DEFAULTS[planCodeForRank(rank)];
}

/**
 * Parses a `feature_configuration` document from the database, falling back to
 * the compiled defaults field by field. An operator who adds a key the code
 * does not know about is ignored rather than crashing the request; an operator
 * who removes one gets the safe default back.
 */
export function parsePlanFeatures(
  raw: unknown,
  planCode: PlanCode,
): PlanFeatures {
  const defaults = PLAN_FEATURE_DEFAULTS[planCode];
  if (typeof raw !== 'object' || raw === null) return defaults;
  const doc = raw as Record<string, unknown>;

  const nullableInt = (key: keyof PlanFeatures, fallback: number | null) => {
    if (!(key in doc)) return fallback;
    const value = doc[key];
    if (value === null) return null;
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.trunc(value)
      : fallback;
  };
  const bool = (key: keyof PlanFeatures, fallback: boolean) =>
    typeof doc[key] === 'boolean' ? (doc[key] as boolean) : fallback;
  const oneOf = <T extends string>(
    key: keyof PlanFeatures,
    allowed: readonly T[],
    fallback: T,
  ): T => {
    const value = doc[key];
    return typeof value === 'string' && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  };

  return {
    savedOpportunityLimit: nullableInt(
      'savedOpportunityLimit',
      defaults.savedOpportunityLimit,
    ),
    savedSearchLimit: nullableInt('savedSearchLimit', defaults.savedSearchLimit),
    csvExport: bool('csvExport', defaults.csvExport),
    immediateAlerts: bool('immediateAlerts', defaults.immediateAlerts),
    opportunityDetail: oneOf(
      'opportunityDetail',
      ['preview', 'summary', 'complete'] as const,
      defaults.opportunityDetail,
    ),
    reportArchive: oneOf(
      'reportArchive',
      ['limited', 'full'] as const,
      defaults.reportArchive,
    ),
    pricingDashboard: oneOf(
      'pricingDashboard',
      ['preview', 'complete'] as const,
      defaults.pricingDashboard,
    ),
    advancedFilters: bool('advancedFilters', defaults.advancedFilters),
    deadlineCalendar: bool('deadlineCalendar', defaults.deadlineCalendar),
    weeklyReports: bool('weeklyReports', defaults.weeklyReports),
    weeklyReminders: bool('weeklyReminders', defaults.weeklyReminders),
    customAlertPreferences: bool(
      'customAlertPreferences',
      defaults.customAlertPreferences,
    ),
    premiumBriefing: bool('premiumBriefing', defaults.premiumBriefing),
    completeDatabaseAccess: bool(
      'completeDatabaseAccess',
      defaults.completeDatabaseAccess,
    ),
    maxPageSize: nullableInt('maxPageSize', defaults.maxPageSize) ?? defaults.maxPageSize,
  };
}
