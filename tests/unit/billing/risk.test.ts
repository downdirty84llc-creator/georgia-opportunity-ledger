import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
const m = vi.hoisted(() => ({
  payments: vi.fn(),
  invoice: vi.fn(),
  matches: vi.fn(),
  update: vi.fn(),
  saved: vi.fn(),
}));
vi.mock('@/lib/billing/stripe', () => ({
  stripe: () => ({
    invoicePayments: { list: m.payments },
    invoices: { retrieve: m.invoice },
  }),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      table === 'subscriptions'
        ? { select: () => ({ in: m.matches }) }
        : { update: m.update },
  }),
}));
import { recordBillingRisk, isBillingRiskEvent } from '@/lib/billing/risk';
const event = (type = 'charge.refunded', changes = {}) =>
  ({
    id: 'evt_test',
    type,
    livemode: false,
    data: {
      object: {
        id: 'ch_test',
        object: 'charge',
        payment_intent: 'pi_test',
        customer: 'cus_test',
        amount_refunded: 500,
        currency: 'usd',
        refunded: false,
        metadata: { user_id: 'untrusted-user' },
        ...changes,
      },
    },
  }) as unknown as Stripe.Event;
function pages(ids: string[]) {
  return (async function* () {
    for (const invoice of ids) yield { invoice };
  })();
}
beforeEach(() => {
  vi.clearAllMocks();
  m.payments.mockReturnValue(pages(['in_one']));
  m.invoice.mockResolvedValue({
    id: 'in_one',
    customer: 'cus_test',
    parent: {
      type: 'subscription_details',
      subscription_details: { subscription: 'sub_one' },
    },
  });
  m.matches.mockResolvedValue({
    data: [
      {
        id: 'local-sub',
        user_id: 'local-owner',
        stripe_customer_id: 'cus_test',
        stripe_subscription_id: 'sub_one',
      },
    ],
    error: null,
  });
  m.update.mockReturnValue({ eq: m.saved });
  m.saved.mockResolvedValue({ error: null });
});
describe('provider billing risk review', () => {
  it('matches a partial refund through the invoice graph, ignoring metadata and preserving review decisions', async () => {
    await recordBillingRisk(event());
    expect(m.payments).toHaveBeenCalledWith({
      payment: { type: 'payment_intent', payment_intent: 'pi_test' },
      status: 'paid',
      limit: 100,
    });
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'local-owner',
        subscription_id: 'local-sub',
        review_context: expect.objectContaining({
          detail: 'Partial refund',
          amount: 500,
          resolution: 'matched',
        }),
      }),
    );
    expect(m.update.mock.calls[0]![0]).not.toHaveProperty('reviewed_at');
    expect(m.update.mock.calls[0]![0]).not.toHaveProperty('review_note');
  });
  it('consumes all invoice payment pages and deduplicates invoices', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `in_${i}`);
    m.payments.mockReturnValue(pages([...ids, ids[0]!]));
    m.invoice.mockImplementation(async (id: string) => ({
      id,
      customer: 'cus_test',
      parent: {
        type: 'subscription_details',
        subscription_details: { subscription: `sub_${id}` },
      },
    }));
    m.matches.mockResolvedValue({ data: [], error: null });
    await recordBillingRisk(event());
    expect(m.invoice).toHaveBeenCalledTimes(101);
    expect(m.update.mock.calls[0]![0].review_context.invoiceIds).toHaveLength(
      101,
    );
    expect(
      m.update.mock.calls[0]![0].review_context.subscriptionIds,
    ).toHaveLength(101);
  });
  it('does not assign a local owner when the invoice customer disagrees', async () => {
    m.matches.mockResolvedValue({
      data: [
        {
          id: 'local-sub',
          user_id: 'wrong-owner',
          stripe_customer_id: 'cus_other',
          stripe_subscription_id: 'sub_one',
        },
      ],
      error: null,
    });
    await recordBillingRisk(event());
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
        subscription_id: null,
        review_context: expect.objectContaining({
          resolution: 'manual_review',
        }),
      }),
    );
  });
  it.each([
    ['charge.refunded', { refunded: true }, 'Full refund'],
    [
      'charge.dispute.created',
      {
        object: 'dispute',
        id: 'dp_test',
        charge: 'ch_test',
        reason: 'fraudulent',
        amount: 1500,
        evidence_details: { due_by: 1900000000 },
      },
      'Dispute: fraudulent',
    ],
    [
      'radar.early_fraud_warning.created',
      {
        object: 'radar.early_fraud_warning',
        id: 'issfr_test',
        charge: 'ch_test',
      },
      'Early fraud warning',
    ],
  ])('queues %s with the relevant detail', async (type, changes, detail) => {
    expect(isBillingRiskEvent(type)).toBe(true);
    await recordBillingRisk(event(type, changes));
    expect(m.update.mock.calls[0]![0].review_context.detail).toBe(detail);
  });
  it('queues a legacy charge with no payment intent for explicit manual review', async () => {
    await recordBillingRisk(event('charge.refunded', { payment_intent: null }));
    expect(m.payments).not.toHaveBeenCalled();
    expect(m.matches).not.toHaveBeenCalled();
    expect(m.update.mock.calls[0]![0].review_context.resolution).toBe(
      'manual_review',
    );
  });
  it.each(['provider', 'lookup', 'save'])(
    'propagates %s failures so the webhook retries',
    async (step) => {
      if (step === 'provider')
        m.invoice.mockRejectedValue(new Error('provider unavailable'));
      if (step === 'lookup')
        m.matches.mockResolvedValue({ error: { message: 'db unavailable' } });
      if (step === 'save')
        m.saved.mockResolvedValue({ error: { message: 'save failed' } });
      await expect(recordBillingRisk(event())).rejects.toThrow();
    },
  );
  it('does not classify regular invoice events as risk events', () => {
    expect(isBillingRiskEvent('invoice.paid')).toBe(false);
  });
});
