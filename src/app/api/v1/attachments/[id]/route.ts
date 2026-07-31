import { NextResponse } from 'next/server';

import { getViewer } from '@/lib/auth/session';
import { signedAttachmentUrl } from '@/lib/files/attachments';
import { apiError, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/attachments/{id}
 *
 * Redirects to a five-minute signed URL for a file the caller may read.
 *
 * There is no access-rank check in this handler and that is deliberate: the
 * lookup inside `signedAttachmentUrl` runs on the caller's own session client,
 * so row-level security decides. That policy already encodes the access rank,
 * the parent record's visibility *and* the scan status, and keeping the
 * decision in one place is what stops this endpoint drifting away from it.
 *
 * Every failure looks the same from outside — not found. A member probing ids
 * learns nothing about whether a file exists, is above their plan, or is sitting
 * in quarantine.
 */
export const GET = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;

    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to download attachments.');
    }
    if (viewer.accountStatus !== 'active') {
      return apiError(
        'forbidden',
        'Your account is not active, so downloads are unavailable.',
      );
    }

    const signed = await signedAttachmentUrl(id);
    if (!signed) return apiError('not_found', 'No such attachment.');

    return NextResponse.redirect(signed.url, {
      status: 302,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
);
