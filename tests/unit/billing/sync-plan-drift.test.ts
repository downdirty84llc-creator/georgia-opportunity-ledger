import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reconciliation job is the safety net for a webhook that never landed.
 *
 * It reconciled status and period end but not the plan, which left the single
 * field that decides what a member may read outside the net: an upgrade or
 * downgrade whose webhook failed kept its old `plan_id` — and so its old access
 * rank — indefinitely. Status recovered on the next run; entitlement did not.
 */

/** The local row, as the job reads it. */
let localRow: Record<string, unknown>;
/** The price id Stripe reports for the subscription. */
let remotePriceId: string;

const updates: Array<Record<string, unknown>> = [];

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'subscriptions') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          not: () => chain,
          limit: () => Promise.resolve({ data: [localRow], error: null }),
          update: (values: Record<string, unknown>) => {
            updates.push(values);
            return { eq: () => Promise.resolve({ error: null }) };
          },
        };
        return chain;
      }
      // billing_events: the unprocessed counter.
      return {
        select: () => ({
          eq: () => Promise.resolve({ count: 0, error: null }),
        }),
      };
    },
  }),
}));

vi.mock('@/lib/billing/plans', () => ({
  planForPriceId: (priceId: string | null) =>
    Promise.resolve(
      priceId === 'price_premium_m'
        ? {
            id: 'plan-premium',
            code: 'premium',
            accessRank: 30,
            interval: 'monthly',
          }
        : priceId === 'price_weekly_m'
          ? {
              id: 'plan-weekly',
              code: 'weekly',
              accessRank: 10,
              interval: 'monthly',
            }
          : null,
    ),
}));

vi.mock('@/lib/billing/stripe', () => ({
  stripe: () => ({
    subscriptions: {
      retrieve: () =>
        Promise.resolve({
          id: 'sub_1',
          status: 'active',
          cancel_at_period_end: false,
          items: {
            data: [
              { price: { id: remotePriceId }, current_period_end: 1790000000 },
            ],
          },
        }),
    },
  }),
  toDate: (value: number | null) =>
    value === null ? null : new Date(value * 1000),
}));

vi.mock('@/lib/exports/service', () => ({
  runExportJob: () => Promise.resolve(),
}));
vi.mock('@/lib/account/deletion', () => ({ DELETION_GRACE_DAYS: 30 }));

const { syncSubscriptionsJob } = await import('@/lib/jobs/maintenance-jobs');

function run() {
  return syncSubscriptionsJob.handler({ note: () => {} } as never);
}

describe('sync-subscriptions', () => {
  beforeEach(() => {
    updates.length = 0;
    // Local state says weekly; the period end already matches, so the plan is
    // the only thing adrift. Without the fix nothing would be written at all.
    localRow = {
      id: 'sub-row-1',
      user_id: 'member-1',
      stripe_subscription_id: 'sub_1',
      status: 'active',
      current_period_end: new Date(1790000000 * 1000).toISOString(),
      plan_id: 'plan-weekly',
      billing_interval: 'monthly',
    };
    remotePriceId = 'price_weekly_m';
    vi.clearAllMocks();
  });

  it('corrects a plan that drifted from Stripe', async () => {
    // Stripe says the member upgraded to premium; we still have them on weekly.
    remotePriceId = 'price_premium_m';

    const result = await run();

    expect(result.processed).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.plan_id).toBe('plan-premium');
    expect(updates[0]?.billing_interval).toBe('monthly');
  });

  it('writes nothing when local state already agrees with Stripe', async () => {
    const result = await run();

    expect(result.processed).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it('leaves the plan alone when the price is not in the catalogue', async () => {
    // A price from another Stripe account, or one the catalogue has not caught
    // up with. Falling back to free here would revoke paid access over a
    // bookkeeping mismatch — which is exactly the failure this project has
    // already had once, from plan rows pointing at another account's prices.
    remotePriceId = 'price_from_another_account';

    await run();

    for (const update of updates) {
      expect(update).not.toHaveProperty('plan_id');
    }
  });
});
