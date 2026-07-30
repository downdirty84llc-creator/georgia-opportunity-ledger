import type { NextResponse } from 'next/server';
import { z } from 'zod';

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

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();
    const { data: plan } = await supabase
      .from('subscription_plans')
      .select(
        'id, code, name, access_rank, stripe_monthly_price_id, stripe_annual_price_id',
      )
      .eq('code', parsed.data.planCode)
      .eq('is_active', true)
      .maybeSingle();

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

    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', viewer.userId)
      .maybeSingle();

    const siteUrl = publicEnv.siteUrl.replace(/\/$/, '');

    const session = await stripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // Reusing the stored customer keeps one Stripe customer per member, so
      // the portal shows their whole billing history rather than a fragment.
      customer: subscription?.stripe_customer_id ?? undefined,
      client_reference_id: viewer.userId,
      metadata: { user_id: viewer.userId, plan_code: plan.code },
      subscription_data: {
        metadata: { user_id: viewer.userId, plan_code: plan.code },
      },
      allow_promotion_codes: !parsed.data.promotionCode,
      discounts: parsed.data.promotionCode
        ? [{ promotion_code: parsed.data.promotionCode }]
        : undefined,
      success_url: `${siteUrl}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/pricing?checkout=cancelled`,
      billing_address_collection: 'auto',
    });

    await track('checkout_started', {
      userId: viewer.userId,
      properties: {
        plan: plan.code,
        interval: parsed.data.interval,
        fromPlan: viewer.planCode,
      },
    });

    return ok({ url: session.url, sessionId: session.id });
  },
);
