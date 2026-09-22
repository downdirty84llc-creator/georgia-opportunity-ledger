import { NextResponse } from 'next/server';
import type Stripe from 'stripe';

import { track } from '@/lib/analytics/events';
import { planForPriceId } from '@/lib/billing/plans';
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
 * `billing_events.stripe_event_id`: the insert is the lock. A conflict means
 * the event was recorded before — which is not the same as saying it was
 * handled. The row is written before processing, so a conflict is only a
 * duplicate to be acknowledged when `processed` is true; when it is false the
 * previous delivery failed part-way and this one reprocesses it.
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

  // Carried across deliveries so a permanently failing event reads as such
  // instead of looking like a first attempt every time.
  let priorAttempts = 0;

  if (insertError) {
    if (insertError.code === '23505') {
      // Recorded before — but "recorded" is not "processed", and conflating
      // the two silently dropped events. The row is written before processing,
      // so a handler that threw left `processed = false` behind and returned a
      // 500. Stripe's retry then landed here and was acknowledged as a
      // duplicate, which meant the one mechanism designed to recover the event
      // was the mechanism that discarded it. Nothing swept it up afterwards
      // either: the reconciliation job counts unprocessed rows for a dashboard
      // number and does not reprocess them.
      const { data: existing, error: readError } = await supabase
        .from('billing_events')
        .select('processed, attempt_count')
        .eq('stripe_event_id', event.id)
        .maybeSingle();

      if (readError) {
        console.error('[stripe-webhook] could not read recorded event', {
          eventId: event.id,
          message: readError.message,
        });
        return NextResponse.json(
          {
            error: {
              code: 'internal_error',
              message: 'Could not read event.',
            },
          },
          { status: 500 },
        );
      }

      if (existing?.processed) {
        // Genuinely done. This is Stripe re-delivering something we completed.
        return NextResponse.json({ received: true, duplicate: true });
      }

      // Recorded but never completed. Fall through and process it.
      priorAttempts = existing?.attempt_count ?? 0;
    } else {
      console.error('[stripe-webhook] could not record event', {
        eventId: event.id,
        message: insertError.message,
      });
      // A retry may succeed once the database recovers.
      return NextResponse.json(
        {
          error: { code: 'internal_error', message: 'Could not record event.' },
        },
        { status: 500 },
      );
    }
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
        attempt_count: priorAttempts + 1,
      })
      .eq('stripe_event_id', event.id);

    // Leave `processed` false and ask Stripe to retry; the redelivery
    // reprocesses rather than being dismissed as a duplicate. The
    // reconciliation job counts what is still unprocessed, so an event failing
    // repeatedly surfaces on the admin dashboard — it does not reprocess them,
    // and an earlier version of this comment wrongly said it did.
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Processing failed.' } },
      { status: 500 },
    );
  }
}

async function handleEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    // `completed` fires when the customer finishes the session, which is not
    // the same as the money having arrived. `async_payment_succeeded` is the
    // moment a delayed payment method actually settles, and it carries the
    // same session, so the same handler provisions from both — the difference
    // is entirely in `payment_status`, which that handler checks.
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      await onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;

    case 'checkout.session.async_payment_failed':
      await onAsyncPaymentFailed(event.data.object as Stripe.Checkout.Session);
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await onSubscriptionChanged(event.data.object as Stripe.Subscription);
      break;

    case 'invoice.payment_succeeded':
      await onPaymentSucceeded(event.data.object as Stripe.Invoice);
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

  // Finishing the session is not the same as paying for it. A delayed payment
  // method — ACH debit, bank transfer, some wallets — completes the session
  // with `payment_status: 'unpaid'` and settles hours or days later, and can
  // still fail. Provisioning here would grant paid access for money that has
  // not arrived and may never.
  //
  // Nothing on this account uses such a method today, so this guard changes no
  // current behaviour. It exists because enabling one is a Dashboard toggle
  // that touches no code: without this, someone turning on ACH would open the
  // hole silently, and the symptom would be free access rather than an error.
  // `checkout.session.async_payment_succeeded` re-enters this function once the
  // payment clears, and by then `payment_status` is `paid`.
  if (session.payment_status === 'unpaid') {
    console.info('[stripe-webhook] session complete but unpaid, deferring', {
      sessionId: session.id,
      userId,
    });
    return;
  }

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

  const supabase = createAdminClient();

  const item = subscription.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = await planForPriceId(priceId, supabase);

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

/**
 * The subscription an invoice belongs to.
 *
 * Stripe moved this: older API versions put `subscription` on the invoice,
 * newer ones nest it under `parent.subscription_details.subscription`. Reading
 * whichever is present matches how `current_period_end` is already handled
 * elsewhere in this file, and means an API version bump does not quietly turn
 * every renewal into a no-op.
 */
function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const record = invoice as unknown as Record<string, unknown>;

  if (typeof record.subscription === 'string') return record.subscription;

  const parent = record.parent as
    { subscription_details?: { subscription?: unknown } } | undefined;
  const nested = parent?.subscription_details?.subscription;
  return typeof nested === 'string' ? nested : null;
}

/**
 * A payment went through.
 *
 * Fires on every successful renewal as well as on recovery from a failure, so
 * the two are told apart before anything is said to the member: nobody wants a
 * "your payment worked" message twelve times a year.
 *
 * The subscription is re-read from Stripe rather than the status being set
 * here. `customer.subscription.updated` usually arrives alongside this event
 * and carries the same transition, but "usually" is not a guarantee — and the
 * status logic already exists in one place. Converging on Stripe's own state
 * keeps one writer rather than two that can disagree.
 */
async function onPaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : null;
  const userId = await resolveUserId(customerId);
  if (!userId) return;

  const supabase = createAdminClient();

  const { data: before } = await supabase
    .from('subscriptions')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle();

  const wasBehind =
    before?.status === 'past_due' || before?.status === 'unpaid';

  const subscriptionId = subscriptionIdOf(invoice);
  if (subscriptionId) {
    const subscription = await stripe().subscriptions.retrieve(subscriptionId);
    await onSubscriptionChanged(subscription, userId);
  }

  // Only when they were actually behind. This is the counterpart to the
  // "we could not process your payment" notice, and leaving that as the last
  // thing a member heard — after the charge has since succeeded — is its own
  // small failure.
  if (wasBehind) {
    await supabase.from('notifications').insert({
      user_id: userId,
      notification_type: 'billing_notice',
      title: 'Your payment went through',
      message:
        'Thanks — your latest payment was successful and your access ' +
        'continues as normal. No action is needed.',
      action_url: '/account/billing',
      dedupe_key: `payment_recovered:${invoice.id}`,
    });
  }
}

/**
 * A delayed payment method failed to settle after the session completed.
 *
 * No access is revoked here. The subscription's own status is Stripe's to
 * decide and arrives as `customer.subscription.updated`; duplicating that
 * judgement from an invoice event is how two writers end up disagreeing about
 * what somebody paid for. What this does is tell the member, because a payment
 * that fails days after checkout is otherwise completely silent — they left
 * the checkout page believing they had subscribed.
 */
async function onAsyncPaymentFailed(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = await resolveUserId(
    typeof session.customer === 'string' ? session.customer : null,
    session.metadata?.user_id ?? session.client_reference_id,
  );
  if (!userId) return;

  const supabase = createAdminClient();
  await supabase.from('notifications').insert({
    user_id: userId,
    notification_type: 'billing_notice',
    title: 'Your payment could not be completed',
    message:
      'The payment you started did not complete, so your subscription has ' +
      'not begun. You can try again from the billing page — nothing you ' +
      'have saved has been affected.',
    action_url: '/account/billing',
    dedupe_key: `async_payment_failed:${session.id}`,
  });
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
