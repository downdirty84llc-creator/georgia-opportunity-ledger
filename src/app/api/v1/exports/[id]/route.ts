import type { NextResponse } from 'next/server';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { signExportDownload } from '@/lib/exports/service';
import { apiError, ok, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/exports/{id}
 *
 * Returns a short-lived signed URL once the export is ready. The URL is minted
 * per request rather than stored, so a link copied out of a browser history
 * stops working within minutes.
 */
export const GET = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to download an export.');
    }
    if (viewer.accountStatus !== 'active') {
      return apiError(
        'forbidden',
        'Your account is suspended, so exports are unavailable.',
      );
    }

    const supabase = await createServerSupabaseClient();
    const { data: job } = await supabase
      .from('export_jobs')
      .select('id, status, row_count, file_path, error_message, expires_at')
      .eq('id', id)
      .eq('user_id', viewer.userId)
      .maybeSingle();

    if (!job) return apiError('not_found', 'Export not found.');

    if (job.status === 'failed') {
      return ok({
        id: job.id,
        status: 'failed',
        message:
          'That export could not be generated. Try again, or contact support if it keeps failing.',
      });
    }

    if (job.status !== 'ready' || !job.file_path) {
      return ok({
        id: job.id,
        status: job.status,
        message: 'Your export is still being prepared.',
      });
    }

    if (job.expires_at && new Date(job.expires_at) < new Date()) {
      return ok({
        id: job.id,
        status: 'expired',
        message: 'That export has expired. Run it again to get a fresh copy.',
      });
    }

    const downloadUrl = await signExportDownload(job.file_path);
    if (!downloadUrl) {
      return apiError(
        'internal_error',
        'The export file could not be prepared for download.',
      );
    }

    return ok({
      id: job.id,
      status: 'ready',
      rowCount: job.row_count,
      downloadUrl,
      expiresInSeconds: 300,
    });
  },
);
