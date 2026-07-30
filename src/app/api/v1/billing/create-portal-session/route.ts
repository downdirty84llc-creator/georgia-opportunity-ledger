import type { NextResponse } from 'next/server';

import { stripe } from '@/lib/billing/stripe';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
import { apiError, ok, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/v1/billing/create-portal-session
 *
 * Payment methods, invoices and card details are handled entirely inside
 * Stripe's portal. Nothing in this application ever sees a card number, which
 * is what keeps the PCI surface at zero (spec 21).
 */
export const POST = withErrorHandling(async (): Promise<NextResponse> => {
  const viewer = await getViewer();
  if (!viewer.isAuthenticated || !viewer.userId) {
    return apiError('unauthorized', 'Sign in to manage billing.');
  }

  const supabase = await createServerSupabaseClient();
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', viewer.userId)
    .maybeSingle();

  if (!subscription?.stripe_customer_id) {
    return apiError(
      'not_found',
      'There is no billing record for this account yet.',
    );
  }

  const session = await stripe().billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${publicEnv.siteUrl.replace(/\/$/, '')}/account/billing`,
  });

  return ok({ url: session.url });
});
