import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { MfaResetError, resetStaffMfa } from '@/lib/auth/mfa-admin';
import { getViewer } from '@/lib/auth/session';
import {
  apiError,
  ok,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Say what happened, in enough detail to be useful later.')
    .max(500),
});

/**
 * POST /api/v1/admin/staff/{id}/reset-mfa
 *
 * Clears a staff member's enrolled second factors so they can enrol again.
 *
 * The reason is mandatory and stored on the audit row. A reset is the one
 * administrative action that reduces the security of another person's account,
 * so "who asked, and how did we know it was them" needs to survive the
 * conversation it was agreed in.
 */
export const POST = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;

    const viewer = await getViewer();
    if (!viewer.isAuthenticated || viewer.accountStatus !== 'active') {
      return apiError('forbidden', 'Administrator access required.');
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationFailed(parsed.error);

    try {
      const result = await resetStaffMfa(
        viewer.userId as string,
        viewer.role,
        id,
        parsed.data.reason,
      );

      return ok({
        ...result,
        message:
          `Cleared ${result.factorsRemoved} factor` +
          `${result.factorsRemoved === 1 ? '' : 's'}. They keep member access ` +
          'and will be asked to enrol again the next time they open the admin ' +
          'area.',
      });
    } catch (error) {
      if (error instanceof MfaResetError) {
        const code =
          error.status === 403
            ? 'forbidden'
            : error.status === 404
              ? 'not_found'
              : 'conflict';
        return apiError(code, error.message);
      }
      throw error;
    }
  },
);
