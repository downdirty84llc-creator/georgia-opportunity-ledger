import type { NextResponse } from 'next/server';

import { getViewer } from '@/lib/auth/session';
import { deleteAttachment } from '@/lib/files/attachments';
import { apiError, noContent, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * DELETE /api/v1/admin/attachments/{id}
 *
 * Removes the row and the stored object. The row is deleted through the
 * caller's session client, so the staff-write policy decides whether it
 * happens; the object is removed with the service role afterwards, because a
 * row without its file is untidy but a file without its row is unreachable and
 * permanent.
 */
export const DELETE = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;

    const viewer = await getViewer();
    if (!viewer.isStaff || viewer.accountStatus !== 'active') {
      return apiError('forbidden', 'Administrator access required.');
    }

    const removed = await deleteAttachment(id);
    if (!removed) return apiError('not_found', 'No such attachment.');

    return noContent();
  },
);
