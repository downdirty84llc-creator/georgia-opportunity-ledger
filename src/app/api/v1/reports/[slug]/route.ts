import type { NextResponse } from 'next/server';

import { canViewReport } from '@/lib/access/entitlements';
import { track } from '@/lib/analytics/events';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { apiError, ok, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ slug: string }> };

/**
 * GET /api/v1/reports/{slug}
 *
 * Sections carry their own minimum access rank, so a Weekly member reads the
 * summary while the pricing appendix stays locked inside the same report.
 */
export const GET = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_request: Request, context: any): Promise<NextResponse> => {
    const { slug } = await (context as RouteContext).params;
    const viewer = await getViewer();
    const supabase = await createServerSupabaseClient();

    const { data: header } = await supabase
      .from('report_previews')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (!header) return apiError('not_found', 'Report not found.');

    const decision = canViewReport(viewer, {
      minimumAccessRank: header.minimum_access_rank,
      isSample: header.is_sample,
      status: 'published',
    });

    if (!decision.allowed) {
      await track('locked_content_viewed', {
        userId: viewer.userId,
        properties: { reportId: String(header.id), plan: viewer.planCode },
      });
      return ok({
        id: header.id,
        title: header.title,
        slug: header.slug,
        reportType: header.report_type,
        periodStart: header.reporting_period_start,
        periodEnd: header.reporting_period_end,
        publishedAt: header.published_at,
        isSample: header.is_sample,
        access: {
          canView: false,
          upgradeMessage: decision.message,
          requiredPlan: decision.requiredPlan,
        },
        sections: [],
        opportunities: [],
      });
    }

    const { data: report, error } = await supabase
      .from('reports')
      .select(
        `
        id, title, slug, report_type, reporting_period_start,
        reporting_period_end, executive_summary, market_commentary,
        published_at, pdf_file_path, is_sample, minimum_access_rank,
        report_sections ( id, section_type, title, content, display_order,
                          minimum_access_rank ),
        report_opportunities ( display_order, editor_commentary,
                               minimum_access_rank,
                               opportunities ( id, slug, title, score,
                                               score_classification,
                                               closing_date, category ) )
      `,
      )
      .eq('slug', slug)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!report) return apiError('not_found', 'Report not found.');

    await track('report_opened', {
      userId: viewer.userId,
      properties: {
        reportId: String(report.id),
        reportType: String(report.report_type),
        plan: viewer.planCode,
      },
    });

    const sections = (report.report_sections ?? [])
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((section) => {
        const unlocked =
          viewer.isStaff || viewer.accessRank >= section.minimum_access_rank;
        return {
          id: section.id,
          type: section.section_type,
          title: section.title,
          content: unlocked ? section.content : null,
          isLocked: !unlocked,
          minimumAccessRank: section.minimum_access_rank,
        };
      });

    const opportunities = (report.report_opportunities ?? [])
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((entry) => {
        const opportunity = Array.isArray(entry.opportunities)
          ? entry.opportunities[0]
          : entry.opportunities;
        const unlocked =
          viewer.isStaff || viewer.accessRank >= entry.minimum_access_rank;
        return {
          id: opportunity?.id ?? null,
          slug: opportunity?.slug ?? null,
          title: opportunity?.title ?? null,
          score: opportunity?.score ?? null,
          classification: opportunity?.score_classification ?? null,
          closingDate: opportunity?.closing_date ?? null,
          category: opportunity?.category ?? null,
          commentary: unlocked ? entry.editor_commentary : null,
          isLocked: !unlocked,
        };
      });

    return ok({
      id: report.id,
      title: report.title,
      slug: report.slug,
      reportType: report.report_type,
      periodStart: report.reporting_period_start,
      periodEnd: report.reporting_period_end,
      executiveSummary: report.executive_summary,
      marketCommentary: report.market_commentary,
      publishedAt: report.published_at,
      hasPdf: Boolean(report.pdf_file_path),
      isSample: report.is_sample,
      access: { canView: true },
      sections,
      opportunities,
    });
  },
);
