import { readJsonBody } from '@/lib/http/request-body';
import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createMemberCheckout } from '@/lib/billing/checkout';
import { billingOperation } from '@/lib/billing/operations';
import { BillingConflict } from '@/lib/billing/plan-change';
import { createAdminClient } from '@/lib/db/admin';
import { track } from '@/lib/analytics/events';
import { priceIdFor, stripe } from '@/lib/billing/stripe';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
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
  promotionCode: z.string().trim().max(60).optional(),
});

/** POST /api/v1/billing/create-checkout-session */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const { viewer } = await getSessionContext();
    if (!viewer.isAuthenticated || !viewer.userId) {
      return apiError('unauthorized', 'Sign in before subscribing.');
    }
    if (viewer.accountStatus !== 'active') {
      return apiError(
        'forbidden',
        'Your account is suspended. Contact support before subscribing.',
      );
    }

    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();
    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select(
        'id, code, name, access_rank, stripe_monthly_price_id, stripe_annual_price_id',
      )
      .eq('code', parsed.data.planCode)
      .eq('is_active', true)
      .maybeSingle();

    if (planError) throw new Error(planError.message);
    if (!plan) return apiError('not_found', 'That plan is not available.');

    const priceId = priceIdFor(
      {
        planId: plan.id,
        code: plan.code,
        name: plan.name,
        monthlyPriceId: plan.stripe_monthly_price_id,
        annualPriceId: plan.stripe_annual_price_id,
        accessRank: plan.access_rank,
      },
      parsed.data.interval,
    );

    if (!priceId) {
      // A plan without a configured Stripe price is a deployment problem, not
      // a member problem — say so plainly rather than failing inside Stripe.
      console.error('[billing] plan is missing a Stripe price id', {
        plan: plan.code,
        interval: parsed.data.interval,
      });
      return apiError(
        'conflict',
        'That billing option is not available yet. Please choose another or contact support.',
      );
    }

    let session;
    try {
      session = await billingOperation(
        viewer.userId,
        'checkout',
        parsed.data,
        (operation) =>
          createMemberCheckout(stripe(), createAdminClient(), {
            userId: viewer.userId!,
            priceId,
            planCode: plan.code,
            promotionCode: parsed.data.promotionCode,
            siteUrl: publicEnv.siteUrl.replace(/\/$/, ''),
            operationId: operation.id,
          }),
      );
    } catch (error) {
      if (error instanceof BillingConflict)
        return apiError('conflict', error.message);
      throw error;
    }

    await track('checkout_started', {
      userId: viewer.userId,
      properties: {
        plan: plan.code,
        interval: parsed.data.interval,
        fromPlan: viewer.planCode,
      },
    });

    return ok(session);
  },
);
