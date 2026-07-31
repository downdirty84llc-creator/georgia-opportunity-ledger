import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { track } from '@/lib/analytics/events';
import { fromStripeStatus } from '@/lib/billing/subscription';
import { stripe, toDate } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/db/admin';
import { serverEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
// The raw body is required for signature verification, so this route must not
// run on the edge runtime where the body may already be transformed.
export const runtime = 'nodejs';

/**
 * POST /api/v1/webhooks/stripe
 *
 * Requirements from spec 10.6: verify the signature, reject invalid requests,
 * process idempotently, record every event, retry safe failures, log errors.
 *
 * Idempotency is enforced by the unique index on
 * `billing_events.stripe_event_id`: the insert is the lock. If it conflicts,
 * this delivery is a Stripe retry of an event we have already recorded, and we
 * acknowledge without reprocessing.
 *
 * The distinction between a 200 and a 500 here matters: a 500 makes Stripe
 * retry. We return 500 only for faults that a retry could plausibly fix
 * (a database blip), and 200 for events we understood but chose not to act on.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const env = serverEnv();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Missing signature.' } },
      { status: 400 },
    );
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      rawBody,
      signature,
      env.stripeWebhookSecret,
    );
  } catch (error) {
    console.error('[stripe-webhook] signature verification failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: { code: 'bad_request', message: 'Invalid signature.' } },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { error: insertError } = await supabase.from('billing_events').insert({
    stripe_event_id: event.id,
    event_type: event.type,
    event_payload: event as unknown as Record<string, unknown>,
    processed: false,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      // Already recorded. Stripe is retrying; acknowledge and stop.
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error('[stripe-webhook] could not record event', {
      eventId: event.id,
      message: insertError.message,
    });
    // A retry may succeed once the database recovers.
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Could not record event.' } },
      { status: 500 },
    );
  }

  try {
    await handleEvent(event);
    await supabase
      .from('billing_events')
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq('stripe_event_id', event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[stripe-webhook] processing failed', {
      eventId: event.id,
      type: event.type,
      message,
    });
    await supabase
      .from('billing_events')
      .update({
        processing_error: message,
        attempt_count: 1,
      })
      .eq('stripe_event_id', event.id);

    // Leave `processed` false and ask Stripe to retry. The reconciliation job
    // also sweeps unprocessed events, so a permanently failing event surfaces
    // on the admin dashboard rather than disappearing.
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Processing failed.' } },
      { status: 500 },
    );
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await onSubscriptionChanged(event.data.object as Stripe.Subscription);
      break;

    case 'invoice.payment_failed':
      await onPaymentFailed(event.data.object as Stripe.Invoice);
      break;

    default:
      // Recorded in billing_events, deliberately not acted on.
      break;
  }
}

/** Resolves our user id for a Stripe customer. */
async function resolveUserId(
  customerId: string | null,
  metadataUserId?: string | null,
): Promise<string | null> {
  if (metadataUserId) return metadataUserId;
  if (!customerId) return null;

  const supabase = createAdminClient();
  const { data } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

async function planForPriceId(priceId: string | null): Promise<{
  id: string;
  code: string;
  access_rank: number;
  interval: 'monthly' | 'annual';
} | null> {
  if (!priceId) return null;
  const supabase = createAdminClient();

  const { data } = await supabase
    .from('subscription_plans')
    .select(
      'id, code, access_rank, stripe_monthly_price_id, stripe_annual_price_id',
    )
    .or(
      `stripe_monthly_price_id.eq.${priceId},stripe_annual_price_id.eq.${priceId}`,
    )
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    code: data.code,
    access_rank: data.access_rank,
    interval: data.stripe_annual_price_id === priceId ? 'annual' : 'monthly',
  };
}

async function onCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = await resolveUserId(
    typeof session.customer === 'string' ? session.customer : null,
    session.metadata?.user_id ?? session.client_reference_id,
  );
  if (!userId) {
    throw new Error(
      `checkout.session.completed ${session.id} could not be matched to a user`,
    );
  }

  const supabase = createAdminClient();
  // Record the customer id straight away so later subscription events can be
  // matched even if their metadata is missing.
  await supabase
    .from('subscriptions')
    .update({
      stripe_customer_id:
        typeof session.customer === 'string' ? session.customer : null,
    })
    .eq('user_id', userId);

  if (typeof session.subscription === 'string') {
    const subscription = await stripe().subscriptions.retrieve(
      session.subscription,
    );
    await onSubscriptionChanged(subscription, userId);
  }

  await track('subscription_purchased', {
    userId,
    properties: {
      mode: session.mode ?? 'subscription',
      currency: session.currency ?? 'usd',
      amountTotal: session.amount_total ?? 0,
    },
  });
}

async function onSubscriptionChanged(
  subscription: Stripe.Subscription,
  knownUserId?: string,
): Promise<void> {
  const customerId =
    typeof subscription.customer === 'string' ? subscription.customer : null;
  const userId =
    knownUserId ??
    (await resolveUserId(customerId, subscription.metadata?.user_id));

  if (!userId) {
    throw new Error(
      `subscription ${subscription.id} could not be matched to a user`,
    );
  }

  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = await planForPriceId(priceId);

  const supabase = createAdminClient();

  // A deleted subscription drops the member to the free plan, but only after
  // the period they paid for has elapsed — `effectiveAccessRank` handles the
  // grace window, so the status is recorded faithfully here.
  let planId = plan?.id;
  if (!planId) {
    const { data: freePlan } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('access_rank', 0)
      .maybeSingle();
    planId = freePlan?.id;
  }
  if (!planId) throw new Error('No subscription plan available to assign');

  const status =
    subscription.status === 'canceled' && !subscription.cancel_at_period_end
      ? 'canceled'
      : fromStripeStatus(subscription.status);

  // The current period lives on the subscription item in recent API versions
  // and on the subscription itself in older ones; read whichever is present.
  const itemRecord = item as unknown as Record<string, unknown> | undefined;
  const subscriptionRecord = subscription as unknown as Record<string, unknown>;
  const periodStart =
    (itemRecord?.current_period_start as number | undefined) ??
    (subscriptionRecord.current_period_start as number | undefined) ??
    null;
  const periodEnd =
    (itemRecord?.current_period_end as number | undefined) ??
    (subscriptionRecord.current_period_end as number | undefined) ??
    null;

  const { error } = await supabase
    .from('subscriptions')
    .update({
      plan_id: planId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
      billing_interval: plan?.interval ?? 'monthly',
      status,
      current_period_start: toDate(periodStart)?.toISOString() ?? null,
      current_period_end: toDate(periodEnd)?.toISOString() ?? null,
      cancel_at_period_end: subscription.cancel_at_period_end,
      trial_end: toDate(subscription.trial_end)?.toISOString() ?? null,
      canceled_at: toDate(subscription.canceled_at)?.toISOString() ?? null,
    })
    .eq('user_id', userId);

  if (error) throw new Error(error.message);

  if (subscription.cancel_at_period_end || status === 'canceled') {
    await track('subscription_canceled', {
      userId,
      properties: { plan: plan?.code ?? 'unknown', status },
    });
  }
}

async function onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : null;
  const userId = await resolveUserId(customerId);
  if (!userId) return;

  const supabase = createAdminClient();
  await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('user_id', userId)
    // Do not overwrite a subscription Stripe has already moved past retrying.
    .in('status', ['active', 'trialing', 'past_due']);

  await supabase.from('notifications').insert({
    user_id: userId,
    notification_type: 'billing_notice',
    title: 'We could not process your payment',
    message:
      'Your latest payment did not go through. Update your payment method in ' +
      'the billing portal to keep your access — nothing you have saved will ' +
      'be lost either way.',
    action_url: '/account/billing',
    dedupe_key: `payment_failed:${invoice.id}`,
  });
}
