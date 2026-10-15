import type { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/session';
import { UploadRejected } from '@/lib/files/attachments';
import { apiError, rateLimited } from '@/lib/http/responses';
import { checkRateLimit, rateLimitIdentity } from '@/lib/http/rate-limit';

export async function uploadAuthority(
  request: Request,
): Promise<string | NextResponse> {
  const viewer = await getViewer();
  if (
    !viewer.isAuthenticated ||
    !viewer.isStaff ||
    viewer.accountStatus !== 'active' ||
    !['researcher', 'reviewer', 'editor', 'super_administrator'].includes(
      viewer.role,
    )
  )
    return apiError('forbidden', 'Editorial access required.');
  const limit = await checkRateLimit(
    'upload',
    rateLimitIdentity(request, viewer.userId),
  );
  if (!limit.allowed) return rateLimited(limit.resetAt);
  return viewer.userId as string;
}
export function uploadFailure(error: unknown): NextResponse {
  if (!(error instanceof UploadRejected)) throw error;
  return apiError(
    error.status === 404
      ? 'not_found'
      : error.status === 409
        ? 'conflict'
        : 'validation_failed',
    error.message,
  );
}
