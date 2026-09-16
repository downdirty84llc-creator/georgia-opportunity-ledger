/**
 * Monthly recurring revenue.
 *
 * This existed inline on the admin dashboard and was wrong: it summed
 * `monthly_price` for every active subscription regardless of billing interval,
 * under a comment claiming it normalised annual plans to a monthly figure. An
 * annual Premium subscriber was counted at $99 rather than the $82.50 they
 * actually contribute each month — an overstatement of about 17% per annual
 * subscriber, on a number used for planning.
 *
 * Three decisions are recorded here rather than left implicit in a format
 * string, because each has a defensible alternative.
 *
 * **Integer arithmetic, in annualised cents.** Prices are `numeric(10, 2)`, so
 * cents are exact; dividing dollars by twelve in floating point is not. Each
 * subscription is converted to the cents it contributes over a year — a monthly
 * plan multiplied by twelve, an annual plan taken as-is — the integers are
 * summed, and the division by twelve happens **once**, at the end.
 *
 * The alternative was to divide each subscription to a monthly figure and round
 * per row. Rejected: that rounds N times instead of once, so a thousand
 * subscribers on a plan that does not divide evenly can drift by a couple of
 * dollars from the true total for no benefit. Annualised cents avoids the
 * choice entirely — nothing is rounded until the single final division, and
 * every intermediate value is an exact integer.
 *
 * **An unrecognised billing interval counts as monthly.** `billing_interval` is
 * `not null default 'monthly'` with only two enum values, so a missing or
 * unknown one means something upstream is already broken — a bad sync, a
 * hand-edited row, a migration in flight. Given that, monthly is the column's
 * own answer for "unspecified", and it is the safer of two bad options:
 * contributing zero would assert that a subscriber with an active subscription
 * pays nothing, which hides a real customer, whereas the monthly reading is at
 * most an overstatement of the same customer by the difference between the two
 * rates. Neither is silent — `unresolvedIntervals` reports how many rows took
 * the fallback, so "the number looks high" has an answer.
 *
 * **Cents, not dollars, are returned.** The dashboard renders through
 * `formatMoney`, which is configured to whole dollars, but that is a display
 * decision and this is the underlying figure. Returning pre-rounded dollars
 * would bake the dashboard's formatting into anything that later reads MRR for
 * an export or an API.
 */

/** Twelve months. Named because it appears in both directions below. */
const MONTHS_PER_YEAR = 12;

export interface MrrSubscription {
  /** `subscriptions.billing_interval`. */
  billingInterval: string | null | undefined;
  /** `subscription_plans.monthly_price`; PostgREST may hand back a string. */
  monthlyPrice: number | string | null | undefined;
  /** `subscription_plans.annual_price`. */
  annualPrice: number | string | null | undefined;
}

export interface MrrTotal {
  /** Monthly recurring revenue, in whole cents. */
  cents: number;
  /** Subscriptions counted. */
  counted: number;
  /**
   * How many rows had a `billing_interval` this code did not recognise and
   * were therefore read as monthly. Non-zero means look at the data, not at
   * this function.
   */
  unresolvedIntervals: number;
}

/**
 * Dollars to whole cents.
 *
 * Returns null for anything non-finite so the caller can decide, rather than
 * quietly folding a missing price into zero revenue.
 */
function toCents(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const asNumber = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(asNumber)) return null;
  // Prices are constrained non-negative in the schema, so Math.round is
  // half-up here without needing the negative-number caveat.
  return Math.round(asNumber * 100);
}

/**
 * What one subscription contributes over a year, in cents.
 *
 * Returns 0 when the relevant price is missing entirely — a plan row that did
 * not come back from the join contributes nothing rather than throwing, since
 * a dashboard that renders no numbers at all is worse than one missing a row.
 */
export function annualisedCents(subscription: MrrSubscription): {
  cents: number;
  intervalResolved: boolean;
} {
  const interval = subscription.billingInterval;

  if (interval === 'annual') {
    return {
      cents: toCents(subscription.annualPrice) ?? 0,
      intervalResolved: true,
    };
  }

  const monthly = toCents(subscription.monthlyPrice) ?? 0;
  return {
    cents: monthly * MONTHS_PER_YEAR,
    intervalResolved: interval === 'monthly',
  };
}

/**
 * Monthly recurring revenue across a set of subscriptions.
 *
 * Filtering by status — and by whether a subscriber is sample data — is the
 * caller's job. This function does arithmetic and nothing else, which is what
 * makes it testable without a database.
 */
export function monthlyRecurringRevenue(
  subscriptions: readonly MrrSubscription[],
): MrrTotal {
  let annualCents = 0;
  let unresolvedIntervals = 0;

  for (const subscription of subscriptions) {
    const { cents, intervalResolved } = annualisedCents(subscription);
    annualCents += cents;
    if (!intervalResolved) unresolvedIntervals += 1;
  }

  return {
    // The single rounding step in the whole calculation.
    cents: Math.round(annualCents / MONTHS_PER_YEAR),
    counted: subscriptions.length,
    unresolvedIntervals,
  };
}

/** Cents to dollars, for handing to `formatMoney`. */
export function centsToDollars(cents: number): number {
  return cents / 100;
}
