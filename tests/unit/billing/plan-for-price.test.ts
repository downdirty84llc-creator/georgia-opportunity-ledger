import { describe, expect, it } from 'vitest';

import { planForPriceId } from '@/lib/billing/plans';
import type { AdminSupabaseClient } from '@/lib/db/admin';

/**
 * The price → plan lookup decides a member's access rank, so the cases that
 * matter are the ones where it should decline to answer rather than guess.
 */

const PLANS = [
  {
    id: 'plan-free',
    code: 'free',
    access_rank: 0,
    stripe_monthly_price_id: null,
    stripe_annual_price_id: null,
  },
  {
    id: 'plan-weekly',
    code: 'weekly',
    access_rank: 10,
    stripe_monthly_price_id: 'price_weekly_m',
    stripe_annual_price_id: 'price_weekly_a',
  },
  {
    id: 'plan-premium',
    code: 'premium',
    access_rank: 30,
    stripe_monthly_price_id: 'price_premium_m',
    stripe_annual_price_id: 'price_premium_a',
  },
];

function client(
  result: { data: unknown; error: { message: string } | null } = {
    data: PLANS,
    error: null,
  },
): AdminSupabaseClient {
  return {
    from: () => ({ select: () => Promise.resolve(result) }),
  } as unknown as AdminSupabaseClient;
}

describe('planForPriceId', () => {
  it('resolves a monthly price to its plan and interval', async () => {
    const plan = await planForPriceId('price_weekly_m', client());
    expect(plan).toEqual({
      id: 'plan-weekly',
      code: 'weekly',
      accessRank: 10,
      interval: 'monthly',
    });
  });

  it('resolves an annual price to its plan and interval', async () => {
    const plan = await planForPriceId('price_premium_a', client());
    expect(plan?.id).toBe('plan-premium');
    expect(plan?.interval).toBe('annual');
  });

  it('returns null for a price it does not recognise', async () => {
    // An unknown price means the catalogue and the database disagree. Saying
    // so lets the caller leave the plan alone; inventing an answer would move
    // somebody between tiers on a bookkeeping mismatch.
    expect(await planForPriceId('price_from_another_account', client())).toBe(
      null,
    );
  });

  it('returns null for a null price without matching the free plan', async () => {
    // The free plan's price ids are legitimately null, so a null price would
    // match it on a naive scan and silently demote a paying member to rank 0.
    expect(await planForPriceId(null, client())).toBe(null);
  });

  it('throws rather than returning null when the read fails', async () => {
    // Null means "no such price" and callers leave the plan untouched. A failed
    // read returning null would be read as that, so a database blip would look
    // like a price that no longer exists.
    await expect(
      planForPriceId(
        'price_weekly_m',
        client({ data: null, error: { message: 'connection reset' } }),
      ),
    ).rejects.toThrow(/connection reset/);
  });
});
