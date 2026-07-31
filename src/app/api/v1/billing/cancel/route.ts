import type { NextResponse } from 'next/server';

import { track } from '@/lib/analytics/events';
import { stripe } from '@/lib/billing/stripe';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { apiError, ok, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/v1/billing/cancel
 *
 * Cancels at the end of the current period. Access continues until then, which
 * is both what spec 9 requires and what the member has paid for; the webhook
 * writes the resulting state.
 */
export const POST = withErrorHandling(async (): Promise<NextResponse> => {
  const { viewer } = await getSessionContext();
  if (!viewer.isAuthenticated || !viewer.userId) {
    return apiError('unauthorized', 'Sign in to cancel your subscription.');
  }

  const supabase = await createServerSupabaseClient();
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id, current_period_end, cancel_at_period_end')
    .eq('user_id', viewer.userId)
    .maybeSingle();

  if (!subscription?.stripe_subscription_id) {
    return apiError('conflict', 'There is no active subscription to cancel.');
  }
  if (subscription.cancel_at_period_end) {
    return ok({
      alreadyScheduled: true,
      accessUntil: subscription.current_period_end,
      message: 'Your subscription is already set to end at the period close.',
    });
  }

  const updated = await stripe().subscriptions.update(
    subscription.stripe_subscription_id,
    { cancel_at_period_end: true },
  );

  await track('subscription_canceled', {
    userId: viewer.userId,
    properties: { plan: viewer.planCode, scheduled: true },
  });

  const item = updated.items.data[0] as unknown as
    Record<string, unknown> | undefined;
  const periodEnd =
    (item?.current_period_end as number | undefined) ??
    ((updated as unknown as Record<string, unknown>).current_period_end as
      number | undefined);

  return ok({
    alreadyScheduled: false,
    accessUntil: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : subscription.current_period_end,
    message:
      'Your subscription will end at the close of the period you have paid ' +
      'for. Everything you have saved stays in your account.',
  });
});
