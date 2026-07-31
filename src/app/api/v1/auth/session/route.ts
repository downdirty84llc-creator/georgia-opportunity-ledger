import type { NextResponse } from 'next/server';

import { getSessionContext } from '@/lib/auth/session';
import {
  paidAccessEndsAt,
  needsPaymentAttention,
} from '@/lib/billing/subscription';
import { ok, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/auth/session
 *
 * Returns the authenticated user and, more usefully, their resolved access
 * level. The client uses this to decide what to render as locked without
 * duplicating the plan matrix.
 */
export const GET = withErrorHandling(async (): Promise<NextResponse> => {
  const context = await getSessionContext();
  const { viewer } = context;

  if (!viewer.isAuthenticated) {
    return ok({
      authenticated: false,
      accessRank: viewer.accessRank,
      planCode: viewer.planCode,
      features: viewer.features,
    });
  }

  return ok({
    authenticated: true,
    userId: viewer.userId,
    role: viewer.role,
    accountStatus: viewer.accountStatus,
    accessRank: viewer.accessRank,
    planCode: context.planCode,
    planName: context.planName,
    isStaff: viewer.isStaff,
    features: viewer.features,
    subscription: {
      status: context.subscriptionStatus,
      currentPeriodEnd: context.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: context.cancelAtPeriodEnd,
      paidAccessEndsAt:
        paidAccessEndsAt(context.subscription)?.toISOString() ?? null,
      needsAttention: needsPaymentAttention(context.subscription),
    },
    profile: context.profile,
  });
});
