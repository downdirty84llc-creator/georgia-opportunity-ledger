import type { NextResponse } from 'next/server';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { UploadRejected, uploadAttachment } from '@/lib/files/attachments';
import {
  apiError,
  created,
  ok,
  rateLimited,
  withErrorHandling,
} from '@/lib/http/responses';
import { checkRateLimit, rateLimitIdentity } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

// Uploads are read whole into memory to be scanned, so the route needs longer
// than the default and the body limit has to allow the largest accepted file.
export const maxDuration = 60;

const EDITORIAL_ROLES = [
  'researcher',
  'reviewer',
  'editor',
  'super_administrator',
];

/**
 * GET /api/v1/admin/attachments?opportunityId=… | ?reportId=…
 *
 * Staff view of a record's files, including the ones members cannot see.
 * Quarantined files appear here deliberately: somebody has to know that an
 * upload was rejected and why.
 */
export const GET = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isStaff || viewer.accountStatus !== 'active') {
      return apiError('forbidden', 'Administrator access required.');
    }

    const url = new URL(request.url);
    const opportunityId = url.searchParams.get('opportunityId');
    const reportId = url.searchParams.get('reportId');
    if (!opportunityId && !reportId) {
      return apiError(
        'bad_request',
        'Give either an opportunityId or a reportId.',
      );
    }

    const supabase = await createServerSupabaseClient();
    let query = supabase
      .from('attachments')
      .select(
        `id, file_name, mime_type, file_size, minimum_access_rank,
         scan_status, scan_detail, scanner, scanned_at, uploaded_at,
         uploaded_by`,
      )
      .order('uploaded_at', { ascending: false })
      .limit(100);

    query = opportunityId
      ? query.eq('opportunity_id', opportunityId)
      : query.eq('report_id', reportId as string);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return ok(data ?? [], { count: data?.length ?? 0 });
  },
);

/**
 * POST /api/v1/admin/attachments
 *
 * Multipart upload. Fields: `file`, one of `opportunityId`/`reportId`, and an
 * optional `minimumAccessRank`.
 *
 * Restricted to editorial roles. Support representatives and billing managers
 * are staff but have no reason to add files to published records, and an
 * upload endpoint is the last place to be generous with who may call it.
 */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (
      !viewer.isAuthenticated ||
      viewer.accountStatus !== 'active' ||
      !EDITORIAL_ROLES.includes(viewer.role)
    ) {
      return apiError('forbidden', 'Editorial access required.');
    }

    const limit = await checkRateLimit(
      'upload',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const form = await request.formData().catch(() => null);
    if (!form) {
      return apiError('bad_request', 'Send the file as multipart form data.');
    }

    const file = form.get('file');
    if (!(file instanceof File)) {
      return apiError('bad_request', 'No file was attached.');
    }

    const rankValue = form.get('minimumAccessRank');
    const minimumAccessRank = Number(rankValue ?? 0);
    if (
      !Number.isInteger(minimumAccessRank) ||
      minimumAccessRank < 0 ||
      minimumAccessRank > 100
    ) {
      return apiError('bad_request', 'minimumAccessRank must be 0–100.');
    }

    try {
      const stored = await uploadAttachment({
        file,
        opportunityId: (form.get('opportunityId') as string | null) || null,
        reportId: (form.get('reportId') as string | null) || null,
        minimumAccessRank,
        uploadedBy: viewer.userId as string,
      });

      if (stored.scanStatus === 'infected') {
        return apiError(
          'conflict',
          `That file was rejected by the virus scanner and has been deleted. ` +
            `Reported: ${stored.scanDetail ?? 'signature match'}.`,
        );
      }

      return created({
        ...stored,
        message:
          stored.scanStatus === 'clean'
            ? 'Uploaded and scanned.'
            : stored.scanStatus === 'skipped'
              ? 'Uploaded. No virus scanner is configured for this environment.'
              : 'Uploaded. The scan did not complete; the file stays hidden ' +
                'from members until it does, and will be retried.',
      });
    } catch (error) {
      if (error instanceof UploadRejected) {
        return apiError(
          error.status === 400 ? 'bad_request' : 'validation_failed',
          error.message,
        );
      }
      throw error;
    }
  },
);
