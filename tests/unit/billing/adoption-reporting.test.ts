import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A refusal and an empty answer must not look the same in the job report.
 *
 * The adoption pass skips a row whose `user_id` is not a plain UUID, because
 * the id is interpolated into Stripe's query language. That skip used to
 * `continue` without counting anything — so in `detail` it was identical to
 * "searched Stripe and found nothing eligible": `adopted: 0`, `ambiguous: 0`,
 * `failed: 0`. Two unrelated facts behind one set of zeroes.
 *
 * It mattered in practice. On 2026-10-15 those zeroes were the only evidence
 * available about a member who had paid and had no access, and the runtime
 * logs that would have separated the two cases had already aged out of the
 * hobby plan's one-hour retention.
 */

/** The unclaimed row the adoption pass finds. */
let unclaimedRow: Record<string, unknown>;
/** Subscriptions Stripe's search returns. */
let searchResults: unknown[];

const searchCalls: unknown[] = [];

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'subscriptions') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          // Reconcile pass: no rows carry a Stripe id in these cases.
          not: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: [], error: null }),
          is: () => {
            const unclaimed: Record<string, unknown> = {
              order: () => unclaimed,
              limit: () =>
                Promise.resolve({ data: [unclaimedRow], error: null }),
            };
            return unclaimed;
          },
          update: () => {
            const result: Record<string, unknown> = {
              eq: () => result,
              is: () => result,
              select: () => result,
              maybeSingle: () =>
                Promise.resolve({ data: { id: 'sub-row-1' }, error: null }),
            };
            return result;
          },
        };
        return chain;
      }
      return {
        select: () => ({
          eq: () => Promise.resolve({ count: 0, error: null }),
        }),
      };
    },
  }),
}));

vi.mock('@/lib/billing/stripe', () => ({
  stripe: () => ({
    subscriptions: {
      search: (args: unknown) => {
        searchCalls.push(args);
        return Promise.resolve({ data: searchResults });
      },
      retrieve: () =>
        Promise.resolve({
          id: 'sub_remote',
          status: 'active',
          customer: 'cus_1',
          cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_weekly_m' } }] },
        }),
    },
  }),
}));

vi.mock('@/lib/billing/payment-state', () => ({
  subscriptionPaymentState: () =>
    Promise.resolve({
      status: 'active',
      periodEnd: '2026-11-15T00:00:00.000Z',
      paidThrough: '2026-11-15T00:00:00.000Z',
      paidPriceId: 'price_weekly_m',
    }),
}));

vi.mock('@/lib/billing/plans', () => ({
  planForPriceId: () =>
    Promise.resolve({
      id: 'plan-weekly',
      code: 'weekly',
      accessRank: 10,
      interval: 'monthly',
    }),
}));

const { syncSubscriptionsJob } = await import('@/lib/jobs/maintenance-jobs');

function run() {
  return syncSubscriptionsJob.handler({
    now: new Date('2026-10-15T12:00:00.000Z'),
    note: () => {},
  } as unknown as Parameters<typeof syncSubscriptionsJob.handler>[0]);
}

describe('adoption reporting', () => {
  beforeEach(() => {
    searchCalls.length = 0;
    searchResults = [];
    unclaimedRow = {
      id: 'sub-row-1',
      user_id: '9030f26c-a77c-44a6-9272-4fcd71bd0440',
      updated_at: '2026-10-15T11:00:00.000Z',
    };
  });

  it('reports a searched-but-empty answer as refused: 0', async () => {
    // Stripe was asked and had nothing eligible. This is the benign case.
    const result = await run();

    expect(searchCalls).toHaveLength(1);
    expect(result.detail).toMatchObject({
      unclaimedChecked: 1,
      adopted: 0,
      refused: 0,
    });
  });

  it('reports a non-UUID id as refused, and never asks Stripe', async () => {
    // The case that used to be invisible. Identical zeroes in `detail`, and a
    // console line that outlives nothing.
    unclaimedRow = { ...unclaimedRow, user_id: "' or 1=1 --" };

    const result = await run();

    expect(searchCalls).toHaveLength(0);
    expect(result.detail).toMatchObject({
      unclaimedChecked: 1,
      adopted: 0,
      refused: 1,
    });
  });

  it('distinguishes the two outcomes from each other', async () => {
    // The property that matters: the same report cannot describe both.
    const empty = await run();

    unclaimedRow = { ...unclaimedRow, user_id: 'not-a-uuid' };
    const skipped = await run();

    expect(empty.detail).not.toEqual(skipped.detail);
    expect((empty.detail as { refused: number }).refused).toBe(0);
    expect((skipped.detail as { refused: number }).refused).toBe(1);
  });

  it('still adopts and counts a real match', async () => {
    // Guards against a counter that reads 0 because nothing works at all.
    searchResults = [
      {
        id: 'sub_remote',
        status: 'active',
        created: 1_791_000_000,
        metadata: { user_id: '9030f26c-a77c-44a6-9272-4fcd71bd0440' },
      },
    ];

    const result = await run();

    expect(result.detail).toMatchObject({ adopted: 1, refused: 0 });
  });
});
