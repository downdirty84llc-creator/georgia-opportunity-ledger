import type { NextResponse } from 'next/server';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { ok, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/reports
 *
 * Lists every published report, flagging the ones the caller's plan cannot
 * open. The archive is deliberately visible in full: seeing what you are
 * missing is the argument for upgrading. Free and Weekly members see the most
 * recent few (`reportArchive: 'limited'`); Detailed and above see everything.
 */
export const GET = withErrorHandling(async (): Promise<NextResponse> => {
  const viewer = await getViewer();
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from('report_previews')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(120);

  if (error) throw new Error(error.message);

  const LIMITED_ARCHIVE_COUNT = 4;
  const rows = (data ?? []).map((row, index) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    reportType: row.report_type,
    periodStart: row.reporting_period_start,
    periodEnd: row.reporting_period_end,
    publishedAt: row.published_at,
    isSample: row.is_sample,
    minimumAccessRank: row.minimum_access_rank,
    isLocked:
      !viewer.isStaff &&
      !row.is_sample &&
      (viewer.accessRank < row.minimum_access_rank ||
        (viewer.features.reportArchive === 'limited' &&
          index >= LIMITED_ARCHIVE_COUNT)),
  }));

  return ok(rows, {
    count: rows.length,
    archiveLevel: viewer.isStaff ? 'full' : viewer.features.reportArchive,
  });
});
