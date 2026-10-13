import type { NextResponse } from 'next/server';

import { billingOperation } from '@/lib/billing/operations';
import { BillingConflict } from '@/lib/billing/plan-change';
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
  if (viewer.accountStatus === 'closed') {
    return apiError(
      'conflict',
      'Your account closure is already canceling billing.',
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: subscription, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id, current_period_end, cancel_at_period_end')
    .eq('user_id', viewer.userId)
    .maybeSingle();

  if (subscriptionError) throw new Error(subscriptionError.message);
  if (!subscription?.stripe_subscription_id) {
    return apiError('conflict', 'There is no active subscription to cancel.');
  }
  let updated;
  try {
    updated = await billingOperation(
      viewer.userId,
      'cancel',
      {},
      async (operation) => {
        const client = stripe();
        const current = await client.subscriptions.retrieve(
          subscription.stripe_subscription_id,
        );
        if (
          current.cancel_at_period_end ||
          ['canceled', 'incomplete_expired'].includes(current.status)
        )
          return current;
        if (current.schedule) {
          const scheduleId =
            typeof current.schedule === 'string'
              ? current.schedule
              : current.schedule.id;
          await client.subscriptionSchedules.release(
            scheduleId,
            {},
            { idempotencyKey: `ledger:release:${operation.id}` },
          );
        }
        return client.subscriptions.update(
          current.id,
          { cancel_at_period_end: true },
          {
            idempotencyKey: `ledger:cancel:${operation.id}`,
          },
        );
      },
    );
  } catch (error) {
    if (error instanceof BillingConflict)
      return apiError('conflict', error.message);
    throw error;
  }

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
