import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Delayed payment methods, and the recovery half of the dunning loop.
 *
 * `checkout.session.completed` means the customer finished the session, not
 * that the money arrived. ACH debit, bank transfers and some wallets complete
 * with `payment_status: 'unpaid'` and settle — or fail — days later.
 * Provisioning on that event alone hands out paid access for a payment that
 * may never happen, and the symptom is free access rather than an error, so
 * nothing surfaces it.
 *
 * Nothing on this account uses such a method today. That is exactly why these
 * tests exist: enabling one is a Dashboard toggle that touches no code, so the
 * guard has to already be here and has to be watched working.
 */

interface SubscriptionRow {
  status: string;
}

let subscriptionRow: SubscriptionRow = { status: 'active' };

const subscriptionUpdates: Array<Record<string, unknown>> = [];
const notifications: Array<Record<string, unknown>> = [];
const retrieve = vi.fn(() =>
  Promise.resolve({
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    trial_end: null,
    canceled_at: null,
    metadata: { user_id: 'member-1' },
    items: { data: [{ price: { id: 'price_1' }, current_period_end: 0 }] },
  }),
);

function subscriptionsTable() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => Promise.resolve({ error: null }),
    maybeSingle: () =>
      Promise.resolve({
        data: { user_id: 'member-1', ...subscriptionRow },
        error: null,
      }),
    update: (values: Record<string, unknown>) => {
      subscriptionUpdates.push(values);
      return chain;
    },
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'subscriptions') return subscriptionsTable();
      if (table === 'notifications') {
        return {
          insert: (values: Record<string, unknown>) => {
            notifications.push(values);
            return Promise.resolve({ error: null });
          },
        };
      }
      // billing_events
      return {
        insert: () => Promise.resolve({ error: null }),
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  }),
}));

vi.mock('@/lib/analytics/events', () => ({ track: () => Promise.resolve() }));

vi.mock('@/lib/billing/plans', () => ({
  planForPriceId: () =>
    Promise.resolve({
      id: 'plan-weekly',
      code: 'weekly',
      accessRank: 10,
      interval: 'monthly',
    }),
}));

vi.mock('@/lib/billing/stripe', () => ({
  stripe: () => ({
    webhooks: { constructEvent: () => currentEvent },
    subscriptions: { retrieve },
  }),
  toDate: (value: number | null) =>
    value === null ? null : new Date(value * 1000),
}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ stripeWebhookSecret: 'whsec_fake' }),
}));

let currentEvent: Record<string, unknown>;

const { POST } = await import('@/app/api/v1/webhooks/stripe/route');

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_1',
    customer: 'cus_1',
    subscription: 'sub_1',
    mode: 'subscription',
    currency: 'usd',
    amount_total: 1500,
    payment_status: 'paid',
    metadata: { user_id: 'member-1' },
    client_reference_id: 'member-1',
    ...overrides,
  };
}

function invoice(overrides: Record<string, unknown> = {}) {
  return { id: 'in_1', customer: 'cus_1', subscription: 'sub_1', ...overrides };
}

function deliver(
  type: string,
  object: Record<string, unknown>,
): Promise<Response> {
  currentEvent = {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type,
    data: { object },
  };
  return POST(
    new Request('https://example.test/api/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: '{}',
    }),
  ) as unknown as Promise<Response>;
}

beforeEach(() => {
  subscriptionRow = { status: 'active' };
  subscriptionUpdates.length = 0;
  notifications.length = 0;
  vi.clearAllMocks();
});

describe('a checkout session whose payment has not settled', () => {
  it('does NOT provision access when payment_status is unpaid', async () => {
    const response = await deliver(
      'checkout.session.completed',
      session({ payment_status: 'unpaid' }),
    );

    expect(response.status).toBe(200);
    // The subscription was never fetched, so nothing was provisioned from it.
    expect(retrieve).not.toHaveBeenCalled();
    // Only the customer-id link was written — no plan, no status.
    for (const update of subscriptionUpdates) {
      expect(update).not.toHaveProperty('plan_id');
      expect(update).not.toHaveProperty('status');
    }
  });

  it('still records the customer id so later events can be matched', async () => {
    // Without this the async success event has nothing to resolve the user by.
    await deliver(
      'checkout.session.completed',
      session({ payment_status: 'unpaid' }),
    );

    expect(
      subscriptionUpdates.some((u) => u.stripe_customer_id === 'cus_1'),
    ).toBe(true);
  });

  it('provisions once the delayed payment succeeds', async () => {
    await deliver(
      'checkout.session.async_payment_succeeded',
      session({ payment_status: 'paid' }),
    );

    expect(retrieve).toHaveBeenCalledWith('sub_1');
    expect(subscriptionUpdates.some((u) => u.plan_id === 'plan-weekly')).toBe(
      true,
    );
  });

  it('tells the member when the delayed payment fails', async () => {
    await deliver('checkout.session.async_payment_failed', session());

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.dedupe_key).toBe('async_payment_failed:cs_1');
    // Access is Stripe's to revoke via customer.subscription.updated; this
    // handler must not make that call itself.
    expect(subscriptionUpdates).toHaveLength(0);
  });

  it('provisions normally for an ordinary paid card session', async () => {
    await deliver('checkout.session.completed', session());

    expect(retrieve).toHaveBeenCalledWith('sub_1');
    expect(subscriptionUpdates.some((u) => u.plan_id === 'plan-weekly')).toBe(
      true,
    );
  });
});

describe('invoice.payment_succeeded', () => {
  it('notifies the member when it recovers a failed payment', async () => {
    subscriptionRow = { status: 'past_due' };

    await deliver('invoice.payment_succeeded', invoice());

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.dedupe_key).toBe('payment_recovered:in_1');
  });

  it('stays quiet on an ordinary renewal', async () => {
    // Fires every billing cycle. Announcing each one would mean twelve
    // "your payment worked" messages a year.
    subscriptionRow = { status: 'active' };

    await deliver('invoice.payment_succeeded', invoice());

    expect(notifications).toHaveLength(0);
  });

  it('reconciles from Stripe rather than setting the status itself', async () => {
    subscriptionRow = { status: 'past_due' };

    await deliver('invoice.payment_succeeded', invoice());

    // One writer for subscription status, not two that can disagree.
    expect(retrieve).toHaveBeenCalledWith('sub_1');
    expect(subscriptionUpdates.some((u) => u.status === 'active')).toBe(true);
  });

  it('finds the subscription under the newer nested invoice shape', async () => {
    // Stripe moved `subscription` under parent.subscription_details in later
    // API versions. Reading only the old location would turn every renewal
    // into a silent no-op after a version bump.
    subscriptionRow = { status: 'past_due' };

    await deliver(
      'invoice.payment_succeeded',
      invoice({
        subscription: undefined,
        parent: { subscription_details: { subscription: 'sub_1' } },
      }),
    );

    expect(retrieve).toHaveBeenCalledWith('sub_1');
  });
});
