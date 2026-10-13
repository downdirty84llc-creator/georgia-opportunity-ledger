import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import type { AdminSupabaseClient } from '@/lib/db/admin';
import { createMemberCheckout } from '@/lib/billing/checkout';

function fixture() {
  const record = { stripe_customer_id: 'cus_1', stripe_subscription_id: null };
  const state = {
    error: null as null | { message: string },
    sessions: [] as Array<Record<string, unknown>>,
    subscriptions: [] as Array<{ status: string }>,
  };
  const query = {
    select: () => query,
    eq: () => query,
    update: vi.fn(() => query),
    single: async () => ({ data: record, error: state.error }),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ error: state.error }).then(resolve),
  };
  const db = { from: () => query } as unknown as AdminSupabaseClient;
  const create = vi.fn().mockResolvedValue({
    id: 'cs_new',
    url: 'https://checkout.stripe.com/new',
  });
  const expire = vi.fn().mockResolvedValue({});
  const customerCreate = vi.fn().mockResolvedValue({ id: 'cus_new' });
  const client = {
    customers: { create: customerCreate },
    subscriptions: {
      list: () =>
        (async function* () {
          yield* state.subscriptions;
        })(),
    },
    checkout: {
      sessions: {
        create,
        expire,
        list: () =>
          (async function* () {
            yield* state.sessions;
          })(),
      },
    },
  } as unknown as Stripe;
  return { record, state, db, client, create, expire, customerCreate };
}
const input = {
  userId: 'member',
  priceId: 'price_weekly',
  planCode: 'weekly',
  siteUrl: 'https://ledger.test',
  operationId: 'op_1',
};

describe('one payable checkout per member', () => {
  it.each(['active', 'trialing', 'past_due', 'incomplete', 'paused', 'unpaid'])(
    'refuses a second subscription when Stripe says %s even with a stale free cache',
    async (status) => {
      const f = fixture();
      f.state.subscriptions = [{ status }];
      await expect(createMemberCheckout(f.client, f.db, input)).rejects.toThrow(
        'already have a subscription',
      );
      expect(f.create).not.toHaveBeenCalled();
    },
  );
  it('reuses an open checkout for the same selection', async () => {
    const f = fixture();
    f.state.sessions = [
      {
        id: 'cs_existing',
        mode: 'subscription',
        url: 'https://checkout.stripe.com/existing',
        metadata: { price_id: input.priceId },
      },
    ];
    expect(await createMemberCheckout(f.client, f.db, input)).toMatchObject({
      sessionId: 'cs_existing',
    });
    expect(f.create).not.toHaveBeenCalled();
  });
  it('expires an older selection before creating the replacement', async () => {
    const f = fixture();
    f.state.sessions = [
      {
        id: 'cs_old',
        mode: 'subscription',
        metadata: { price_id: 'price_old' },
      },
    ];
    await createMemberCheckout(f.client, f.db, input);
    expect(f.expire).toHaveBeenCalledWith('cs_old');
    expect(f.create.mock.calls[0]![1]).toEqual({
      idempotencyKey: 'ledger:checkout:op_1',
    });
    expect(f.expire.mock.invocationCallOrder[0]!).toBeLessThan(
      f.create.mock.invocationCallOrder[0]!,
    );
  });
  it('does not create another checkout if expiration has an unknown outcome', async () => {
    const f = fixture();
    f.state.sessions = [{ id: 'cs_old', mode: 'subscription' }];
    f.expire.mockRejectedValue(new Error('timeout'));
    await expect(createMemberCheckout(f.client, f.db, input)).rejects.toThrow(
      'timeout',
    );
    expect(f.create).not.toHaveBeenCalled();
  });
  it('fails closed when the local billing record cannot be read', async () => {
    const f = fixture();
    f.state.error = { message: 'database unavailable' };
    await expect(createMemberCheckout(f.client, f.db, input)).rejects.toThrow(
      'billing record',
    );
    expect(f.customerCreate).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });
});
