import type { NextResponse } from 'next/server';

import {
  canCancelDeletion,
  daysUntilPurge,
  DELETION_GRACE_DAYS,
  purgeDueAt,
} from '@/lib/account/deletion';
import { track } from '@/lib/analytics/events';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  checkRateLimit,
  rateLimitHeaders,
  rateLimitIdentity,
} from '@/lib/http/rate-limit';
import { apiError, ok, rateLimited, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/account/deletion — request deletion.
 * DELETE /api/v1/account/deletion — withdraw the request.
 *
 * The Privacy Policy offers this control, so it exists here rather than as a
 * support ticket somebody has to action by hand. Access ends immediately; the
 * data is purged by the daily job once the grace window has passed.
 *
 * Written through the session-bound client so row-level security is still the
 * backstop: a member can only ever close their own account, whatever this
 * handler does.
 */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isAuthenticated || !viewer.userId) {
      return apiError('unauthorized', 'Sign in to manage your account.');
    }

    const limit = await checkRateLimit(
      'accountDeletion',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const supabase = await createServerSupabaseClient();
    const requestedAt = new Date();

    // account_status is guarded against member writes by
    // guard_profile_privilege_changes, so closing an account is done through
    // the deletion RPC rather than a direct update.
    const { error } = await supabase.rpc('request_account_deletion');
    if (error) {
      return apiError(
        'conflict',
        'Your deletion request could not be recorded. Contact support.',
        { reason: error.message },
      );
    }

    await track('account_deletion_requested', { userId: viewer.userId });

    return ok(
      {
        requestedAt: requestedAt.toISOString(),
        purgeDueAt: purgeDueAt(requestedAt).toISOString(),
        graceDays: DELETION_GRACE_DAYS,
        daysRemaining: daysUntilPurge(requestedAt, requestedAt),
        message:
          `Your account is closed and will be permanently deleted in ` +
          `${DELETION_GRACE_DAYS} days. Sign in before then to change your ` +
          `mind. Records we are required to keep for tax and accounting are ` +
          `retained, without your name attached.`,
      },
      undefined,
      { headers: rateLimitHeaders(limit) },
    );
  },
);

export const DELETE = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isAuthenticated || !viewer.userId) {
      return apiError('unauthorized', 'Sign in to manage your account.');
    }

    const limit = await checkRateLimit(
      'accountDeletion',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const supabase = await createServerSupabaseClient();

    const { data: profile } = await supabase
      .from('profiles')
      .select('deletion_requested_at, account_status')
      .eq('id', viewer.userId)
      .maybeSingle();

    const requestedAt = (profile as { deletion_requested_at?: string } | null)
      ?.deletion_requested_at;

    if (
      !requestedAt ||
      !canCancelDeletion({
        requestedAt: new Date(requestedAt),
        accountStatus: 'closed',
      })
    ) {
      return apiError('not_found', 'There is no deletion request to withdraw.');
    }

    const { error } = await supabase.rpc('cancel_account_deletion');
    if (error) {
      return apiError(
        'conflict',
        'Your request could not be withdrawn. Contact support.',
        { reason: error.message },
      );
    }

    return ok(
      { message: 'Your account is open again and nothing has been deleted.' },
      undefined,
      { headers: rateLimitHeaders(limit) },
    );
  },
);
