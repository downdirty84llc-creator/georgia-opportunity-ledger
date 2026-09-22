import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A webhook delivery that fails part-way must be reprocessed on Stripe's retry.
 *
 * The route records the event before it handles it, so a handler that throws
 * leaves `processed = false` behind and answers 500. Stripe then retries — and
 * the retry used to hit the unique-index conflict, be read as "already seen",
 * and be acknowledged with 200 without ever running. The single mechanism
 * designed to recover the event was the one discarding it, and nothing else
 * swept it up: the reconciliation job counts unprocessed rows for a dashboard
 * number rather than reprocessing them.
 *
 * The distinction these tests hold is the one that was collapsed: **recorded is
 * not processed.** A conflict is a duplicate to acknowledge only when
 * `processed` is true.
 */

const CONFLICT = { code: '23505', message: 'duplicate key value' };

/** What the billing_events row looks like when the route reads it back. */
let existingRow: { processed: boolean; attempt_count: number } | null = null;
/** Set true to make the insert conflict, simulating a redelivery. */
let insertConflicts = false;
/** Set true to make the event handler throw. */
let handlerThrows = false;

const updates: Array<Record<string, unknown>> = [];
const subscriptionRetrieve = vi.fn();

function billingEventsTable() {
  return {
    insert: () => Promise.resolve({ error: insertConflicts ? CONFLICT : null }),
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve({ data: existingRow, error: null }),
      }),
    }),
    update: (values: Record<string, unknown>) => {
      updates.push(values);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  };
}

function subscriptionsTable() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    in: () => Promise.resolve({ error: null }),
    maybeSingle: () =>
      Promise.resolve({ data: { user_id: 'member-1' }, error: null }),
    update: () => chain,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve),
  };
  return chain;
}

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'billing_events') return billingEventsTable();
      if (table === 'subscriptions') return subscriptionsTable();
      return {
        insert: () => Promise.resolve({ error: null }),
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      };
    },
  }),
}));

vi.mock('@/lib/analytics/events', () => ({ track: () => Promise.resolve() }));

vi.mock('@/lib/billing/plans', () => ({
  planForPriceId: () =>
    handlerThrows
      ? Promise.reject(new Error('database unavailable'))
      : Promise.resolve({
          id: 'plan-weekly',
          code: 'weekly',
          accessRank: 10,
          interval: 'monthly',
        }),
}));

const STRIPE_EVENT = {
  id: 'evt_test_1',
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      cancel_at_period_end: false,
      trial_end: null,
      canceled_at: null,
      metadata: { user_id: 'member-1' },
      items: { data: [{ price: { id: 'price_1' }, current_period_end: 0 }] },
    },
  },
};

vi.mock('@/lib/billing/stripe', () => ({
  stripe: () => ({
    webhooks: { constructEvent: () => STRIPE_EVENT },
    subscriptions: { retrieve: subscriptionRetrieve },
  }),
  toDate: (value: number | null) =>
    value === null ? null : new Date(value * 1000),
}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ stripeWebhookSecret: 'whsec_fake' }),
}));

const { POST } = await import('@/app/api/v1/webhooks/stripe/route');

function deliver(): Promise<Response> {
  return POST(
    new Request('https://example.test/api/v1/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'sig' },
      body: '{}',
    }),
  ) as unknown as Promise<Response>;
}

describe('a redelivered webhook event', () => {
  beforeEach(() => {
    existingRow = null;
    insertConflicts = false;
    handlerThrows = false;
    updates.length = 0;
    vi.clearAllMocks();
  });

  it('is acknowledged without reprocessing when it was already processed', async () => {
    insertConflicts = true;
    existingRow = { processed: true, attempt_count: 0 };

    const response = await deliver();
    const body = (await response.json()) as { duplicate?: boolean };

    expect(response.status).toBe(200);
    expect(body.duplicate).toBe(true);
    // Nothing was written: a completed event must not be handled twice.
    expect(updates).toHaveLength(0);
  });

  it('IS reprocessed when it was recorded but never processed', async () => {
    // The case the old code dropped on the floor.
    insertConflicts = true;
    existingRow = { processed: false, attempt_count: 1 };

    const response = await deliver();
    const body = (await response.json()) as { duplicate?: boolean };

    expect(response.status).toBe(200);
    expect(body.duplicate).toBeUndefined();
    // It ran: the row was marked processed.
    expect(updates.some((u) => u.processed === true)).toBe(true);
  });

  it('asks Stripe to retry again when reprocessing fails', async () => {
    insertConflicts = true;
    existingRow = { processed: false, attempt_count: 1 };
    handlerThrows = true;

    const response = await deliver();

    // A 500 is what makes Stripe redeliver. A 200 here would end the retries
    // with the event still unhandled.
    expect(response.status).toBe(500);
    expect(updates.some((u) => u.processed === true)).toBe(false);
  });

  it('carries the attempt count across deliveries instead of resetting it', async () => {
    // attempt_count was hardcoded to 1 on every failure, so an event failing
    // for the fifth time was indistinguishable from one failing for the first.
    insertConflicts = true;
    existingRow = { processed: false, attempt_count: 4 };
    handlerThrows = true;

    await deliver();

    const failure = updates.find((u) => 'attempt_count' in u);
    expect(failure?.attempt_count).toBe(5);
  });

  it('counts a first-ever delivery as attempt 1 when it fails', async () => {
    insertConflicts = false;
    handlerThrows = true;

    await deliver();

    const failure = updates.find((u) => 'attempt_count' in u);
    expect(failure?.attempt_count).toBe(1);
  });
});
