import { createPublicSupabaseClient } from '@/lib/db/public';
import type { ScoreClassification } from '@/lib/scoring/score';

/**
 * Read helpers for public pages.
 *
 * Everything here reads the teaser projections that are safe for signed-out
 * visitors, so a marketing page can never accidentally render paid content.
 *
 * All of it goes through the *anonymous* client rather than the session-bound
 * one. That is deliberate: the session client reads cookies, which would force
 * every landing page to render per request and defeat the caching spec 23 asks
 * for. Nothing here needs to know who is asking.
 *
 * Each helper degrades to an empty result rather than throwing: a database
 * hiccup should soften the home page, not return a 500 to a prospective
 * subscriber. The one exception is a production build — see `softFail`.
 */

/**
 * Logs a read failure, and fails the build if one happens during a deployable
 * prerender.
 *
 * These pages are statically generated and then served from cache for the
 * whole `revalidate` window. Degrading to an empty result is the right answer
 * at request time, but during a production or staging build it would bake an
 * empty home page and serve it to every visitor for the next five minutes —
 * and keep doing so on each failed revalidation. A deployment that cannot
 * reach the database should stop at the deployment, not reach customers.
 *
 * Developer builds without a local database are allowed through, because the
 * alternative is that nobody can run `next build` without Supabase running.
 */
function softFail(context: string, error: unknown): void {
  console.error(`[public-data] ${context}`, error);

  const deployable =
    process.env.NEXT_PHASE === 'phase-production-build' &&
    (process.env.NEXT_PUBLIC_ENVIRONMENT === 'production' ||
      process.env.NEXT_PUBLIC_ENVIRONMENT === 'staging');

  if (deployable) {
    throw error instanceof Error ? error : new Error(`public-data: ${context}`);
  }
}

export interface PublicStats {
  activeOpportunities: number;
  countiesCovered: number;
  verifiedThisWeek: number;
  upcomingDeadlines: number;
}

export async function loadPublicStats(): Promise<PublicStats> {
  try {
    const supabase = createPublicSupabaseClient();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const inTwoWeeks = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const [active, counties, verified, deadlines] = await Promise.all([
      supabase
        .from('opportunity_previews')
        .select('id', { count: 'exact', head: true })
        .eq('is_expired', false),
      supabase
        .from('counties')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),
      supabase
        .from('opportunity_previews')
        .select('id', { count: 'exact', head: true })
        .gte('date_verified', weekAgo),
      supabase
        .from('opportunity_previews')
        .select('id', { count: 'exact', head: true })
        .eq('is_expired', false)
        .lte('closing_date', inTwoWeeks)
        .not('closing_date', 'is', null),
    ]);

    return {
      activeOpportunities: active.count ?? 0,
      countiesCovered: counties.count ?? 0,
      verifiedThisWeek: verified.count ?? 0,
      upcomingDeadlines: deadlines.count ?? 0,
    };
  } catch (error) {
    softFail('stats unavailable', error);
    return {
      activeOpportunities: 0,
      countiesCovered: 0,
      verifiedThisWeek: 0,
      upcomingDeadlines: 0,
    };
  }
}

export interface PreviewOpportunity {
  id: string;
  slug: string;
  title: string;
  category: string;
  subtype: string;
  teaser: string;
  score: number;
  classification: ScoreClassification;
  county: string | null;
  countySlug: string | null;
  city: string | null;
  closingDate: string | null;
  isClosingSoon: boolean;
  isExpired: boolean;
  isSample: boolean;
  minimumAccessRank: number;
}

function mapPreview(row: Record<string, unknown>): PreviewOpportunity {
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    category: String(row.category),
    subtype: String(row.subtype ?? ''),
    teaser: String(row.teaser ?? ''),
    score: Number(row.score ?? 0),
    classification: String(
      row.score_classification ?? 'information_only',
    ) as ScoreClassification,
    county: (row.county_name as string | null) ?? null,
    countySlug: (row.county_slug as string | null) ?? null,
    city: (row.city_name as string | null) ?? null,
    closingDate: (row.closing_date as string | null) ?? null,
    isClosingSoon: Boolean(row.is_closing_soon),
    isExpired: Boolean(row.is_expired),
    isSample: Boolean(row.is_sample),
    minimumAccessRank: Number(row.minimum_access_rank ?? 0),
  };
}

export async function loadPreviewOpportunities(
  options: {
    limit?: number;
    category?: string;
    countySlug?: string;
    closingSoon?: boolean;
  } = {},
): Promise<PreviewOpportunity[]> {
  try {
    const supabase = createPublicSupabaseClient();
    let query = supabase
      .from('opportunity_previews')
      .select('*')
      .eq('is_expired', false)
      .order('score', { ascending: false })
      .limit(options.limit ?? 6);

    if (options.category) query = query.eq('category', options.category);
    if (options.countySlug) query = query.eq('county_slug', options.countySlug);
    if (options.closingSoon) query = query.eq('is_closing_soon', true);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).map(mapPreview);
  } catch (error) {
    softFail('preview load failed', error);
    return [];
  }
}

export interface PlanSummary {
  id: string;
  code: string;
  name: string;
  description: string;
  monthlyPrice: number;
  annualPrice: number;
  accessRank: number;
  isRecommended: boolean;
  features: Record<string, unknown>;
}

export async function loadPlans(): Promise<PlanSummary[]> {
  try {
    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase
      .from('subscription_plans')
      .select(
        `id, code, name, description, monthly_price, annual_price,
         access_rank, is_recommended, feature_configuration`,
      )
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      monthlyPrice: Number(row.monthly_price),
      annualPrice: Number(row.annual_price),
      accessRank: row.access_rank,
      isRecommended: Boolean(row.is_recommended),
      features: (row.feature_configuration ?? {}) as Record<string, unknown>,
    }));
  } catch (error) {
    softFail('plan load failed', error);
    return [];
  }
}

export interface IndicatorPreview {
  id: string;
  name: string;
  slug: string;
  category: string;
  unit: string;
  scope: string;
  trend: string | null;
  percentChange: number | null;
  periodEnd: string | null;
  minimumAccessRank: number;
  isSample: boolean;
}

export async function loadIndicatorPreviews(
  limit = 6,
): Promise<IndicatorPreview[]> {
  try {
    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase
      .from('market_indicator_previews')
      .select('*')
      .order('display_order', { ascending: true })
      .limit(limit);

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      category: row.category,
      unit: row.unit,
      scope: row.geographic_scope,
      trend: row.trend_direction,
      percentChange:
        row.percent_change === null ? null : Number(row.percent_change),
      periodEnd: row.reporting_period_end,
      minimumAccessRank: row.minimum_access_rank,
      isSample: Boolean(row.is_sample),
    }));
  } catch (error) {
    softFail('indicator load failed', error);
    return [];
  }
}

export async function loadCountiesWithCounts(): Promise<
  Array<{ slug: string; name: string; count: number }>
> {
  try {
    const supabase = createPublicSupabaseClient();
    const { data, error } = await supabase.rpc('opportunity_facets');
    if (error) throw new Error(error.message);

    return (
      (data ?? []) as Array<{
        facet: string;
        key: string;
        label: string;
        count: number;
      }>
    )
      .filter((row) => row.facet === 'county')
      .map((row) => ({
        slug: row.key,
        name: row.label,
        count: Number(row.count),
      }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    softFail('county facet load failed', error);
    return [];
  }
}
