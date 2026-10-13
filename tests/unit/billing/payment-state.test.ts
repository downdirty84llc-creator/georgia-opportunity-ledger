import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { subscriptionPaymentState } from '@/lib/billing/payment-state';
import { subscriptionAccessRank } from '@/lib/billing/subscription';

const prior = 1782864000;
const end = prior + 31 * 86400;
function invoice(status: string, paidEnd = end) {
  return {
    id: 'in_1',
    status,
    lines: {
      data: [
        {
          amount: 1500,
          pricing: { price_details: { price: 'price_1' } },
          parent: { subscription_item_details: { subscription: 'sub_1' } },
          period: { end: paidEnd },
        },
      ],
    },
  };
}
function remote(status = 'active', latest: unknown = invoice('open')) {
  return {
    id: 'sub_1',
    status,
    latest_invoice: latest,
    items: {
      data: [
        {
          price: { id: 'price_1' },
          current_period_start: prior,
          current_period_end: end,
        },
      ],
    },
  } as Stripe.Subscription;
}
function client(paid: unknown[] = []) {
  return {
    invoices: {
      list: vi.fn(async () => ({ data: paid, has_more: false })),
      retrieve: vi.fn(async () => invoice('paid')),
    },
  } as unknown as Stripe;
}
describe('settled subscription access', () => {
  it('keeps the settled tier when an asynchronous upgrade changes the price before payment', async () => {
    const changed = remote();
    changed.items.data[0]!.price.id = 'price_unpaid_upgrade';
    const state = await subscriptionPaymentState(
      client([invoice('paid')]),
      changed,
    );
    expect(state.status).toBe('past_due');
    expect(state.paidPriceId).toBe('price_1');
  });
  it.each(['open', 'void', 'uncollectible'])(
    'does not provision an active subscription with an unpaid %s invoice',
    async (status) => {
      const state = await subscriptionPaymentState(
        client(),
        remote('active', invoice(status)),
      );
      expect(state.status).toBe('incomplete');
      expect(state.paidThrough).toBeNull();
    },
  );
  it('grants access after settlement, including zero-dollar promotion invoices', async () => {
    const paid = invoice('paid');
    paid.lines.data[0]!.amount = 0;
    const state = await subscriptionPaymentState(
      client(),
      remote('active', paid),
    );
    expect(state.status).toBe('active');
    expect(state.paidThrough).toBe(new Date(end * 1000).toISOString());
  });
  it('recovers a paid period from invoice history after a missed webhook', async () => {
    const state = await subscriptionPaymentState(
      client([invoice('paid', end)]),
      remote(),
    );
    expect(state.status).toBe('active');
  });
  it('keeps a failed pending upgrade on its existing paid access', async () => {
    const state = await subscriptionPaymentState(
      client([invoice('paid')]),
      remote(),
      new Date(end * 1000).toISOString(),
    );
    expect(state.status).toBe('active');
  });
  it('measures failed renewal grace from the paid period, not the new unpaid month', async () => {
    const state = await subscriptionPaymentState(
      client([invoice('paid', prior)]),
      remote('past_due'),
    );
    const subscription = {
      status: state.status,
      paidThrough: new Date(state.paidThrough!),
      currentPeriodEnd: new Date(state.periodEnd!),
      cancelAtPeriodEnd: false,
      planAccessRank: 30,
    };
    expect(
      subscriptionAccessRank(
        subscription,
        new Date((prior + 2 * 86400) * 1000),
      ),
    ).toBe(30);
    expect(
      subscriptionAccessRank(
        subscription,
        new Date((prior + 4 * 86400) * 1000),
      ),
    ).toBe(0);
  });
  it('cancellation cannot turn an unpaid initial subscription into paid access', async () => {
    expect(
      (await subscriptionPaymentState(client(), remote('canceled'))).status,
    ).toBe('expired');
  });
  it('active and past-due cache rows without evidence fail closed', () => {
    for (const status of ['active', 'past_due', 'canceled'] as const)
      expect(
        subscriptionAccessRank(
          {
            status,
            paidThrough: null,
            currentPeriodEnd: new Date(end * 1000),
            cancelAtPeriodEnd: false,
            planAccessRank: 30,
          },
          new Date(prior * 1000),
        ),
      ).toBe(0);
  });
  it('does not provision when invoice history is unavailable', async () => {
    const api = client();
    vi.mocked(api.invoices.list).mockRejectedValue(
      new Error('Stripe unavailable'),
    );
    await expect(subscriptionPaymentState(api, remote())).rejects.toThrow(
      'Stripe unavailable',
    );
  });
});
