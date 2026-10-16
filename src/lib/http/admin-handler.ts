import type { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth/session';
import { getMfaStatus, mfaRequiredForRole } from '@/lib/auth/mfa';
import { apiError, withErrorHandling } from '@/lib/http/responses';

/** Every admin route has its own gate; layouts do not protect API calls. */
export function withAdminHandling(
  handler: (request: Request, context: never) => Promise<NextResponse>,
) {
  return withErrorHandling(async (request, context) => {
    const viewer = await getViewer();
    if (
      !viewer.isAuthenticated ||
      viewer.accountStatus !== 'active' ||
      !mfaRequiredForRole(viewer.role)
    ) {
      return apiError('forbidden', 'Active staff access required.');
    }
    const status = await getMfaStatus(true);
    if (status.state !== 'satisfied') {
      return apiError(
        'forbidden',
        status.state === 'unavailable'
          ? 'Two-factor verification is temporarily unavailable. Try again shortly.'
          : 'Complete two-factor verification on the Security page.',
        { securityUrl: '/admin/security' },
      );
    }
    return handler(request, context);
  });
}
