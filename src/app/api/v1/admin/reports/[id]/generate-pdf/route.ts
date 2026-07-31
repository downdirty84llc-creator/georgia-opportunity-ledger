import type { NextResponse } from 'next/server';

import { getViewer } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/db/admin';
import { createServerSupabaseClient } from '@/lib/db/server';
import { serverEnv } from '@/lib/env';
import { checkRateLimit, rateLimitIdentity } from '@/lib/http/rate-limit';
import {
  apiError,
  ok,
  rateLimited,
  withErrorHandling,
} from '@/lib/http/responses';
import {
  renderPdf,
  reportToBlocks,
  type ReportForPdf,
} from '@/lib/reports/pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/** Rich-text fields are stored as jsonb; flatten whatever shape they hold. */
function toPlainText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(toPlainText).filter(Boolean).join('\n\n');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (Array.isArray(record.content)) return toPlainText(record.content);
  }
  return null;
}

/** POST /api/v1/admin/reports/{id}/generate-pdf */
export const POST = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const viewer = await getViewer();

    if (
      !viewer.isAuthenticated ||
      viewer.accountStatus !== 'active' ||
      !['editor', 'super_administrator'].includes(viewer.role)
    ) {
      return apiError('forbidden', 'Only an editor can generate a report PDF.');
    }

    const limit = await checkRateLimit(
      'reportGeneration',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const supabase = await createServerSupabaseClient();
    const { data: report, error } = await supabase
      .from('reports')
      .select(
        `
        id, title, slug, report_type, reporting_period_start,
        reporting_period_end, executive_summary, market_commentary, is_sample,
        report_sections ( title, content, display_order ),
        report_opportunities ( display_order, editor_commentary,
          opportunities ( title, score, score_classification, closing_date,
                          counties ( name ) ) )
      `,
      )
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!report) return apiError('not_found', 'Report not found.');

    const model: ReportForPdf = {
      title: report.title,
      reportType: report.report_type,
      periodStart: report.reporting_period_start,
      periodEnd: report.reporting_period_end,
      executiveSummary: toPlainText(report.executive_summary),
      marketCommentary: toPlainText(report.market_commentary),
      isSample: report.is_sample,
      sections: (report.report_sections ?? [])
        .slice()
        .sort((a, b) => a.display_order - b.display_order)
        .map((section) => ({
          title: section.title,
          content: toPlainText(section.content),
        })),
      opportunities: (report.report_opportunities ?? [])
        .slice()
        .sort((a, b) => a.display_order - b.display_order)
        .map((entry) => {
          const opportunity = Array.isArray(entry.opportunities)
            ? entry.opportunities[0]
            : entry.opportunities;
          const county = opportunity?.counties as { name?: string } | null;
          return {
            title: opportunity?.title ?? 'Untitled record',
            county: county?.name ?? null,
            score: opportunity?.score ?? 0,
            classification:
              opportunity?.score_classification ?? 'information_only',
            closingDate: opportunity?.closing_date ?? null,
            commentary: entry.editor_commentary,
          };
        }),
    };

    const pdf = renderPdf(reportToBlocks(model));
    const filePath = `${report.slug}/${report.slug}-${Date.now()}.pdf`;

    const admin = createAdminClient();
    const { error: uploadError } = await admin.storage
      .from(serverEnv().storageBuckets.reports)
      .upload(filePath, pdf, { contentType: 'application/pdf', upsert: true });

    if (uploadError) {
      throw new Error(`Report PDF upload failed: ${uploadError.message}`);
    }

    await admin
      .from('reports')
      .update({ pdf_file_path: filePath })
      .eq('id', id);

    return ok({
      id: report.id,
      filePath,
      byteLength: pdf.byteLength,
      message: 'Report PDF generated.',
    });
  },
);
