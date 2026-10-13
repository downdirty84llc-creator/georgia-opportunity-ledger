import type Stripe from 'stripe';

import { BillingConflict } from '@/lib/billing/plan-change';
import type { AdminSupabaseClient } from '@/lib/db/admin';

export async function createMemberCheckout(
  client: Stripe,
  db: AdminSupabaseClient,
  input: {
    userId: string;
    priceId: string;
    planCode: string;
    promotionCode?: string;
    siteUrl: string;
    operationId: string;
  },
) {
  const { data: record, error } = await db
    .from('subscriptions')
    .select('stripe_customer_id, stripe_subscription_id')
    .eq('user_id', input.userId)
    .single();
  if (error || !record) throw new Error('Could not read the billing record');
  let customerId: string | null = record.stripe_customer_id;
  if (!customerId) {
    const customer = await client.customers.create(
      { metadata: { user_id: input.userId } },
      {
        idempotencyKey: `ledger:customer:${input.operationId}`,
      },
    );
    customerId = customer.id;
    const { error: saveError } = await db
      .from('subscriptions')
      .update({ stripe_customer_id: customerId })
      .eq('user_id', input.userId);
    if (saveError) throw new Error(saveError.message);
  }
  // Read Stripe, not the eventually consistent webhook cache. Even incomplete
  // and paused subscriptions must be resolved before a new purchase is opened.
  for await (const subscription of client.subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 100,
  })) {
    if (!['canceled', 'incomplete_expired'].includes(subscription.status)) {
      throw new BillingConflict(
        'You already have a subscription or payment in progress. Use Manage subscription on your billing page.',
      );
    }
  }
  for await (const session of client.checkout.sessions.list({
    customer: customerId,
    status: 'open',
    limit: 100,
  })) {
    if (session.mode !== 'subscription') continue;
    if (
      session.metadata?.price_id === input.priceId &&
      (session.metadata?.promotion_code ?? '') === (input.promotionCode ?? '')
    ) {
      return { url: session.url, sessionId: session.id };
    }
    // A customer changing their mind must not retain another payable link.
    await client.checkout.sessions.expire(session.id);
  }
  const session = await client.checkout.sessions.create(
    {
      mode: 'subscription',
      customer: customerId,
      integration_identifier: 'georgia_opportunity_ledger_qmrvxjkt',
      line_items: [{ price: input.priceId, quantity: 1 }],
      client_reference_id: input.userId,
      metadata: {
        user_id: input.userId,
        plan_code: input.planCode,
        price_id: input.priceId,
        promotion_code: input.promotionCode ?? '',
      },
      subscription_data: {
        metadata: { user_id: input.userId, plan_code: input.planCode },
      },
      allow_promotion_codes: !input.promotionCode,
      discounts: input.promotionCode
        ? [{ promotion_code: input.promotionCode }]
        : undefined,
      success_url: `${input.siteUrl}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.siteUrl}/pricing?checkout=cancelled`,
      billing_address_collection: 'auto',
    },
    { idempotencyKey: `ledger:checkout:${input.operationId}` },
  );
  return { url: session.url, sessionId: session.id };
}
