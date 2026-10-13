import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { billingOperation } from '@/lib/billing/operations';
import {
  BillingConflict,
  changeSubscriptionPlan,
} from '@/lib/billing/plan-change';
import { planForPriceId } from '@/lib/billing/plans';
import { track } from '@/lib/analytics/events';
import { planChangeDirection, priceIdFor, stripe } from '@/lib/billing/stripe';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  apiError,
  ok,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  planCode: z.enum(['weekly', 'detailed', 'premium']),
  interval: z.enum(['monthly', 'annual']).default('monthly'),
});

/**
 * POST /api/v1/billing/change-plan
 *
 * Upgrades apply immediately with proration; downgrades take effect at the end
 * of the period the member has already paid for. The subscription row is not
 * written here — Stripe's `customer.subscription.updated` webhook is the single
 * writer, so there is one path into our billing state rather than two that can
 * disagree.
 */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const { viewer } = await getSessionContext();
    if (!viewer.isAuthenticated || !viewer.userId) {
      return apiError('unauthorized', 'Sign in to change your plan.');
    }
    if (viewer.accountStatus !== 'active') {
      return apiError('forbidden', 'Your account is not active.');
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();

    const { data: subscription, error: subscriptionError } = await supabase
      .from('subscriptions')
      .select(
        'stripe_subscription_id, plan_id, subscription_plans!inner(access_rank, code)',
      )
      .eq('user_id', viewer.userId)
      .maybeSingle();

    if (subscriptionError) throw new Error(subscriptionError.message);
    if (!subscription?.stripe_subscription_id) {
      return apiError(
        'conflict',
        'You do not have an active paid subscription to change. Start a new subscription instead.',
      );
    }

    const currentPlan = Array.isArray(subscription.subscription_plans)
      ? subscription.subscription_plans[0]
      : subscription.subscription_plans;

    const { data: targetPlan, error: targetError } = await supabase
      .from('subscription_plans')
      .select(
        'id, code, name, access_rank, stripe_monthly_price_id, stripe_annual_price_id',
      )
      .eq('code', parsed.data.planCode)
      .eq('is_active', true)
      .maybeSingle();

    if (targetError) throw new Error(targetError.message);
    if (!targetPlan)
      return apiError('not_found', 'That plan is not available.');

    const priceId = priceIdFor(
      {
        planId: targetPlan.id,
        code: targetPlan.code,
        name: targetPlan.name,
        monthlyPriceId: targetPlan.stripe_monthly_price_id,
        annualPriceId: targetPlan.stripe_annual_price_id,
        accessRank: targetPlan.access_rank,
      },
      parsed.data.interval,
    );
    if (!priceId) {
      return apiError('conflict', 'That billing option is not available yet.');
    }

    let result;
    try {
      result = await billingOperation(
        viewer.userId,
        'change_plan',
        parsed.data,
        async (operation) => {
          const existing = await stripe().subscriptions.retrieve(
            subscription.stripe_subscription_id,
          );
          const remotePlan = await planForPriceId(
            existing.items.data[0]?.price.id ?? null,
            supabase,
          );
          if (!remotePlan)
            throw new BillingConflict(
              'Your current Stripe price is not in the plan catalogue. Contact support.',
            );
          return changeSubscriptionPlan(
            stripe(),
            existing,
            {
              priceId,
              planCode: targetPlan.code,
              interval: parsed.data.interval,
              direction: planChangeDirection(
                remotePlan.accessRank,
                targetPlan.access_rank,
              ),
            },
            operation.id,
          );
        },
      );
    } catch (error) {
      if (error instanceof BillingConflict)
        return apiError('conflict', error.message);
      throw error;
    }
    const direction = result.direction;

    await track(
      direction === 'upgrade'
        ? 'subscription_upgraded'
        : 'subscription_downgraded',
      {
        userId: viewer.userId,
        properties: {
          fromPlan: currentPlan?.code ?? 'unknown',
          toPlan: targetPlan.code,
          interval: parsed.data.interval,
        },
      },
    );

    return ok(result);
  },
);
