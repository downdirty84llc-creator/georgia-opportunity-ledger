import type { NextResponse } from 'next/server';

import { track } from '@/lib/analytics/events';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { apiError, ok, withErrorHandling } from '@/lib/http/responses';
import { loadOpportunityDetail } from '@/lib/opportunities/query';
import { serializeOpportunity } from '@/lib/opportunities/serialize';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ idOrSlug: string }> };

/**
 * GET /api/v1/opportunities/{id-or-slug}
 *
 * A record the caller's plan cannot open still returns 200 with the preview
 * payload and an `access` block explaining what is missing — a 402 here would
 * lose the teaser the upgrade prompt is built from. A record that does not
 * exist, and one hidden by row-level security, both return 404 so ids cannot
 * be probed.
 */
export const GET = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request: Request, context: any): Promise<NextResponse> => {
    const { idOrSlug } = await (context as RouteContext).params;
    const viewer = await getViewer();
    const supabase = await createServerSupabaseClient();

    const record = await loadOpportunityDetail(supabase, idOrSlug);

    if (!record) {
      // Row-level security may have filtered a real record. Fall back to the
      // teaser projection so a locked record still renders its upgrade prompt.
      const { data: preview } = await supabase
        .from('opportunity_previews')
        .select('*')
        .or(`slug.eq.${idOrSlug},id.eq.${idOrSlug}`)
        .maybeSingle();

      if (!preview) return apiError('not_found', 'Record not found.');

      await track('locked_content_viewed', {
        userId: viewer.userId,
        properties: {
          opportunityId: String(preview.id),
          requiredRank: Number(preview.minimum_access_rank ?? 0),
          plan: viewer.planCode,
        },
      });

      return ok({
        id: preview.id,
        slug: preview.slug,
        title: preview.title,
        category: preview.category,
        subtype: preview.subtype,
        teaser: preview.teaser,
        score: preview.score,
        classification: preview.score_classification,
        status: preview.status,
        county: preview.county_name,
        city: preview.city_name,
        state: preview.state_abbreviation,
        industry: preview.industry_name,
        closingDate: preview.closing_date,
        isClosingSoon: preview.is_closing_soon,
        isExpired: preview.is_expired,
        isSample: preview.is_sample,
        dateVerified: preview.date_verified,
        minimumAccessRank: preview.minimum_access_rank,
        access: {
          detailLevel: 'preview',
          canViewFull: false,
          lockedSections: [
            'Executive summary',
            'Full analysis',
            'Financial overview',
            'Eligibility and property details',
            'Risk factors',
            'Recommended next action',
            'Source information',
          ],
          upgradeMessage:
            'This record is included with a higher membership tier.',
          reason: 'upgrade_required',
        },
      });
    }

    const serialized = serializeOpportunity(record, viewer);

    await track(
      serialized.access.canViewFull ? 'opportunity_viewed' : 'locked_content_viewed',
      {
        userId: viewer.userId,
        properties: {
          opportunityId: serialized.id,
          category: serialized.category,
          score: serialized.score,
          detailLevel: serialized.access.detailLevel,
          plan: viewer.planCode,
        },
      },
    );

    return ok(serialized);
  },
);
