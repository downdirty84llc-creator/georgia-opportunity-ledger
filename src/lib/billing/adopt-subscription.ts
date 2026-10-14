/**
 * Adopting a subscription the webhook never told us about.
 *
 * `sync-subscriptions` was the safety net for a webhook that failed, but it
 * only ever looked at rows where `stripe_subscription_id` was already set — and
 * that column is written **only** by the webhook. So the net caught changes to
 * subscriptions it already knew about and could not discover one it had never
 * heard of. That is exactly the first-purchase case, and on 2026-10-13 it was
 * the difference between "a few hours late" and "permanently invisible": a
 * real payment's events were rejected on a signature mismatch, Stripe treated
 * the 400 as permanent and never retried, and nothing downstream could find
 * the subscription afterwards.
 *
 * The join key is `metadata.user_id`, set by `create-checkout-session` on
 * `subscription_data`. That matters for more than convenience: it is written by
 * our own server, so a customer cannot forge it, and it is the only identifier
 * that ties a Stripe subscription to an account without trusting an email
 * address. **Never match on email** — addresses collide, change, and are
 * attacker-chosen at signup.
 */

/** The subset of a Stripe subscription this decision needs. */
export interface AdoptableSubscription {
  id: string;
  status: string;
  created: number;
  metadata?: Record<string, string> | null;
}

/**
 * Statuses worth adopting.
 *
 * `past_due` and `unpaid` are included deliberately: they carry entitlement
 * through the grace window, and `expire-lapsed-access` needs the row to exist
 * before it can expire it. Terminal and not-yet-paid states are excluded —
 * `canceled` and `incomplete_expired` grant nothing, and `incomplete` means
 * the customer never completed payment, so adopting it would record a
 * subscription that was never owed.
 */
export const ADOPTABLE_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'trialing',
  'past_due',
  'unpaid',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Stripe search query for one account's subscriptions, or `null` when the
 * id is not a plain UUID.
 *
 * The id is interpolated into a query language, so it is validated rather than
 * escaped. Every id reaching here comes from our own `subscriptions.user_id`
 * column and is a UUID; refusing anything else keeps it that way if a caller
 * ever changes.
 */
export function subscriptionSearchQuery(userId: string): string | null {
  if (!UUID.test(userId)) return null;
  return `metadata['user_id']:'${userId}'`;
}

export interface AdoptionDecision {
  /** The subscription to adopt, or null when none qualifies. */
  chosen: AdoptableSubscription | null;
  /** How many candidates named this account and held an adoptable status. */
  eligible: number;
  /**
   * More than one qualified. The newest is chosen, and the caller logs it: two
   * live subscriptions for one account is a billing problem of its own and
   * should not be settled silently by a reconciler.
   */
  ambiguous: boolean;
}

/**
 * Chooses which of Stripe's answers to adopt.
 *
 * The `metadata.user_id` check is repeated here even though the search query
 * already filters on it. Stripe's search is eventually consistent and its
 * query language is not this function's contract; a reconciler that grants paid
 * access should not rely on a remote filter it cannot see.
 */
export function chooseSubscriptionToAdopt(
  candidates: readonly AdoptableSubscription[],
  userId: string,
): AdoptionDecision {
  const eligible = candidates
    .filter((candidate) => candidate.metadata?.user_id === userId)
    .filter((candidate) => ADOPTABLE_STATUSES.has(candidate.status))
    .sort((a, b) => b.created - a.created);

  return {
    chosen: eligible[0] ?? null,
    eligible: eligible.length,
    ambiguous: eligible.length > 1,
  };
}
