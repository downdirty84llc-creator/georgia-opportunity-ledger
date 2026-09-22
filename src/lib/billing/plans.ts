import type { AdminSupabaseClient } from '@/lib/db/admin';

/**
 * Which plan a Stripe price belongs to.
 *
 * Shared by the webhook handler and the reconciliation job so the two cannot
 * disagree about what a price means. They previously had no shared answer at
 * all: the webhook resolved a plan from the price, and the job did not look at
 * the price, so a subscription whose plan changed while the webhook was failing
 * kept its old `plan_id` — and therefore its old access rank — for good.
 */

export interface PlanForPrice {
  id: string;
  code: string;
  accessRank: number;
  interval: 'monthly' | 'annual';
}

interface PlanRow {
  id: string;
  code: string;
  access_rank: number;
  stripe_monthly_price_id: string | null;
  stripe_annual_price_id: string | null;
}

/**
 * Reads every plan and matches in memory rather than filtering server-side.
 *
 * There are four rows, so the round trip is the cost either way. The previous
 * version built a PostgREST `.or()` filter by interpolating the price id into a
 * query string, which works only for as long as the id contains nothing the
 * filter grammar treats specially — a property of Stripe's id format rather
 * than of anything this code enforces. Matching in TypeScript removes the
 * question.
 */
export async function planForPriceId(
  priceId: string | null,
  client: AdminSupabaseClient,
): Promise<PlanForPrice | null> {
  // Guard before the scan: a null price would otherwise match a free plan,
  // whose price ids are legitimately null.
  if (!priceId) return null;

  const { data, error } = await client
    .from('subscription_plans')
    .select(
      'id, code, access_rank, stripe_monthly_price_id, stripe_annual_price_id',
    );

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as unknown as PlanRow[]) {
    if (row.stripe_annual_price_id === priceId) {
      return {
        id: row.id,
        code: row.code,
        accessRank: row.access_rank,
        interval: 'annual',
      };
    }
    if (row.stripe_monthly_price_id === priceId) {
      return {
        id: row.id,
        code: row.code,
        accessRank: row.access_rank,
        interval: 'monthly',
      };
    }
  }

  return null;
}
