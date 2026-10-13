import type Stripe from 'stripe';

import { createAdminClient } from '@/lib/db/admin';
import { stripe } from '@/lib/billing/stripe';
import type { JobDefinition } from '@/lib/jobs/runner';

/** Closure is immediate; no refund, proration or new final invoice is created. */
export async function stopSubscriptionForClosure(
  client: Stripe,
  subscription: Stripe.Subscription,
) {
  if (['canceled', 'incomplete_expired'].includes(subscription.status)) return;
  if (subscription.schedule) {
    const scheduleId =
      typeof subscription.schedule === 'string'
        ? subscription.schedule
        : subscription.schedule.id;
    // Canceling a schedule also cancels its underlying subscription.
    await client.subscriptionSchedules.cancel(scheduleId, {
      invoice_now: false,
      prorate: false,
    });
  } else {
    await client.subscriptions.cancel(subscription.id, {
      invoice_now: false,
      prorate: false,
    });
  }
}

export async function closeAccountBilling(
  userId: string,
  deadline = Date.now() + 35_000,
): Promise<boolean> {
  const db = createAdminClient();
  const { data: closure, error: claimError } = await db.rpc(
    'claim_account_billing_closure',
    { p_user_id: userId },
  );
  if (claimError) throw new Error(claimError.message);
  if (!closure?.lease_token) {
    const { data, error } = await db
      .from('account_billing_closures')
      .select('completed_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data?.completed_at);
  }
  try {
    const { data, error } = await db
      .from('subscriptions')
      .select('stripe_customer_id, stripe_subscription_id')
      .eq('user_id', userId)
      .single();
    if (error) throw new Error(error.message);
    let customerId: string | null = data.stripe_customer_id;
    if (!customerId && data.stripe_subscription_id) {
      const existing = await stripe().subscriptions.retrieve(
        data.stripe_subscription_id,
      );
      customerId =
        typeof existing.customer === 'string'
          ? existing.customer
          : existing.customer.id;
    }
    if (customerId) {
      const client = stripe();
      for await (const session of client.checkout.sessions.list({
        customer: customerId,
        status: 'open',
        limit: 100,
      })) {
        if (Date.now() > deadline)
          throw new Error('Billing cleanup will continue on the next retry');
        if (session.mode === 'subscription')
          await client.checkout.sessions.expire(session.id);
      }
      for await (const subscription of client.subscriptions.list({
        customer: customerId,
        status: 'all',
        limit: 100,
      })) {
        if (Date.now() > deadline)
          throw new Error('Billing cleanup will continue on the next retry');
        await stopSubscriptionForClosure(client, subscription);
      }
    }
    const { data: finished, error: finishError } = await db
      .from('account_billing_closures')
      .update({
        completed_at: new Date().toISOString(),
        last_error: null,
        lease_until: null,
      })
      .eq('user_id', userId)
      .eq('lease_token', closure.lease_token)
      .select('user_id')
      .maybeSingle();
    if (finishError) throw new Error(finishError.message);
    if (!finished)
      throw new Error('Billing cleanup lease changed before completion');
    return true;
  } catch (error) {
    const { error: logError } = await db
      .from('account_billing_closures')
      .update({
        last_error: error instanceof Error ? error.message : String(error),
        lease_until: null,
      })
      .eq('user_id', userId)
      .eq('lease_token', closure.lease_token);
    if (logError)
      console.error(
        '[billing-closure] Could not record provider failure',
        logError.message,
      );
    throw error;
  }
}

export const closeAccountBillingJob: JobDefinition = {
  name: 'close-account-billing',
  description:
    'Stops billing and expires checkout links for closed accounts; failures remain queued for retry.',
  handler: async () => {
    const db = createAdminClient();
    const { data, error } = await db
      .from('account_billing_closures')
      .select('user_id')
      .is('completed_at', null)
      .order('requested_at')
      .limit(20);
    if (error) throw new Error(error.message);
    let processed = 0;
    let failed = 0;
    const deadline = Date.now() + 35_000;
    for (const row of data ?? []) {
      if (Date.now() > deadline) break;
      try {
        if (await closeAccountBilling(row.user_id, deadline)) processed += 1;
      } catch (error) {
        failed += 1;
        console.error('[billing-closure]', error);
      }
    }
    return { processed, failed, detail: { checked: processed + failed } };
  },
};
