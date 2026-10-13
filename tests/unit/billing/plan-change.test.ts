import { describe, expect, it, vi } from 'vitest';
import type Stripe from 'stripe';
import { changeSubscriptionPlan, copyPhase } from '@/lib/billing/plan-change';

function fixture() {
  const phase = {
    start_date: 100,
    end_date: 200,
    add_invoice_items: [],
    items: [
      {
        price: { id: 'price_premium' },
        quantity: 1,
        discounts: [],
        tax_rates: [{ id: 'tx_item' }],
        metadata: { retained: 'yes' },
      },
    ],
    discounts: [{ discount: { id: 'di_existing' } }],
    default_tax_rates: [{ id: 'tx_default' }],
    automatic_tax: { enabled: false },
    default_payment_method: { id: 'pm_existing' },
    collection_method: 'charge_automatically',
    currency: 'usd',
    proration_behavior: 'none',
    metadata: { user_id: 'member' },
    invoice_settings: {
      footer: 'Keep this footer',
      account_tax_ids: [{ id: 'txi_existing' }],
    },
  } as unknown as Stripe.SubscriptionSchedule.Phase;
  const schedule = {
    id: 'sched_1',
    phases: [phase],
    current_phase: { start_date: 100 },
    metadata: { ledger_plan_change: 'true' },
  };
  const sub = {
    id: 'sub_1',
    status: 'active',
    items: {
      data: [
        {
          id: 'si_1',
          quantity: 1,
          price: { id: 'price_premium' },
          current_period_end: 200,
        },
      ],
    },
  } as Stripe.Subscription;
  const update = vi.fn().mockResolvedValue({ pending_update: null });
  const scheduleUpdate = vi.fn().mockResolvedValue(schedule);
  const create = vi.fn().mockResolvedValue(schedule);
  const client = {
    subscriptions: { update },
    subscriptionSchedules: {
      create,
      update: scheduleUpdate,
      retrieve: vi.fn().mockResolvedValue(schedule),
    },
  } as unknown as Stripe;
  return { phase, schedule, sub, client, update, scheduleUpdate, create };
}
const target = {
  priceId: 'price_weekly',
  planCode: 'weekly',
  interval: 'monthly',
  direction: 'downgrade',
} as const;

describe('paid plan transitions', () => {
  it('schedules a downgrade at renewal without changing the current price', async () => {
    const f = fixture();
    const result = await changeSubscriptionPlan(
      f.client,
      f.sub,
      target,
      'op_1',
    );
    expect(f.update).not.toHaveBeenCalled();
    const phases = f.scheduleUpdate.mock.calls[0]![1].phases;
    expect(phases[0]).toMatchObject({
      start_date: 100,
      end_date: 200,
      items: [{ price: 'price_premium' }],
    });
    expect(phases[1]).toMatchObject({
      start_date: 200,
      duration: { interval: 'month', interval_count: 1 },
      items: [{ price: 'price_weekly' }],
    });
    expect(result.effective).toBe('end_of_period');
  });
  it('retains discounts, tax rates, payment settings, metadata and invoice settings', () => {
    expect(copyPhase(fixture().phase)).toMatchObject({
      discounts: [{ discount: 'di_existing' }],
      default_tax_rates: ['tx_default'],
      default_payment_method: 'pm_existing',
      metadata: { user_id: 'member' },
      invoice_settings: {
        footer: 'Keep this footer',
        account_tax_ids: ['txi_existing'],
      },
      items: [{ tax_rates: ['tx_item'], metadata: { retained: 'yes' } }],
    });
  });
  it('allows a same-tier interval change at renewal', async () => {
    const f = fixture();
    await changeSubscriptionPlan(
      f.client,
      f.sub,
      { ...target, direction: 'same', interval: 'annual' },
      'op_1',
    );
    expect(f.scheduleUpdate.mock.calls[0]![1].phases[1].duration.interval).toBe(
      'year',
    );
  });
  it('does not claim an unpaid upgrade is active', async () => {
    const f = fixture();
    f.update.mockResolvedValue({
      pending_update: { expires_at: 300 },
      latest_invoice: { hosted_invoice_url: 'https://invoice.stripe.com/test' },
    });
    const result = await changeSubscriptionPlan(
      f.client,
      f.sub,
      { ...target, direction: 'upgrade' },
      'op_1',
    );
    expect(f.update.mock.calls[0]![1].payment_behavior).toBe(
      'pending_if_incomplete',
    );
    expect(result).toMatchObject({
      effective: 'payment_required',
      url: 'https://invoice.stripe.com/test',
    });
  });
  it('does not silently reverse an existing cancellation', async () => {
    const f = fixture();
    f.sub.cancel_at_period_end = true;
    await expect(
      changeSubscriptionPlan(f.client, f.sub, target, 'op_1'),
    ).rejects.toThrow('cancellation');
    expect(f.create).not.toHaveBeenCalled();
  });
  it('replays the original schedule creation after a crash before tagging', async () => {
    const f = fixture();
    f.sub.schedule = 'sched_1';
    f.schedule.metadata = {} as typeof f.schedule.metadata;
    await changeSubscriptionPlan(f.client, f.sub, target, 'op_1');
    expect(f.create).toHaveBeenCalledWith(
      { from_subscription: 'sub_1' },
      { idempotencyKey: 'ledger:schedule:op_1' },
    );
  });
  it('refuses an unrelated schedule without overwriting it', async () => {
    const f = fixture();
    f.sub.schedule = 'sched_1';
    f.schedule.metadata = {} as typeof f.schedule.metadata;
    f.create.mockRejectedValue({ type: 'StripeInvalidRequestError' });
    await expect(
      changeSubscriptionPlan(f.client, f.sub, target, 'new_op'),
    ).rejects.toThrow('custom schedule');
    expect(f.scheduleUpdate).not.toHaveBeenCalled();
  });
});
