import type { NextResponse } from 'next/server';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  apiError,
  ok,
  rateLimited,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';
import {
  checkRateLimit,
  rateLimitHeaders,
  rateLimitIdentity,
} from '@/lib/http/rate-limit';
import { searchOpportunities } from '@/lib/opportunities/query';
import { filterSchema } from '@/lib/search/filters';
import { track } from '@/lib/analytics/events';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/opportunities
 *
 * Access-controlled search. Records above the caller's plan are returned as
 * locked teasers rather than hidden, because the upgrade prompt is the point;
 * the database function does the column-level redaction.
 */
export const GET = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const url = new URL(request.url);
    const parsed = filterSchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return validationFailed(parsed.error);

    const viewer = await getViewer();

    const limit = await checkRateLimit(
      'search',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    if (viewer.isAuthenticated && viewer.accountStatus !== 'active') {
      return apiError(
        'forbidden',
        'Your account is suspended. Contact support to appeal.',
      );
    }

    const supabase = await createServerSupabaseClient();
    const result = await searchOpportunities(supabase, viewer, parsed.data);

    await track('search_performed', {
      userId: viewer.userId,
      properties: {
        resultCount: result.totalCount,
        sort: parsed.data.sort,
        hasKeyword: Boolean(parsed.data.q),
        filterCount: Object.keys(parsed.data).length,
        plan: viewer.planCode,
      },
    });

    return ok(
      result.rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        category: row.category,
        subtype: row.subtype,
        teaser: row.teaser,
        summary: row.summary,
        score: row.score,
        classification: row.score_classification,
        scoreExplanation: row.score_explanation,
        status: row.status,
        county: row.county_name,
        countySlug: row.county_slug,
        city: row.city_name,
        state: row.state_abbreviation,
        industry: row.industry_name,
        propertyType: row.property_type,
        fundingType: row.funding_type,
        estimatedValueMin: row.estimated_value_min,
        estimatedValueMax: row.estimated_value_max,
        capitalRequiredMin: row.capital_required_min,
        capitalRequiredMax: row.capital_required_max,
        closingDate: row.closing_date,
        isClosingSoon: row.is_closing_soon,
        isExpired: row.is_expired,
        isFeatured: row.is_featured,
        isSample: row.is_sample,
        verificationStatus: row.verification_status,
        dateVerified: row.date_verified,
        publishedAt: row.published_at,
        minimumAccessRank: row.minimum_access_rank,
        isLocked: row.is_locked,
      })),
      {
        count: result.totalCount,
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        droppedFilters: result.droppedFilters,
        plan: viewer.planCode,
      },
      { headers: rateLimitHeaders(limit) },
    );
  },
);
