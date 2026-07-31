/**
 * Subscription status → access rank.
 *
 * This is the TypeScript half of the rule pair; the SQL half lives in
 * `public.subscription_access_rank` / `public.effective_access_rank`
 * (migration 0015). Both are enforced — the API checks here before it queries,
 * and row-level security checks in the database — so a bug in one layer is
 * caught by the other rather than leaking a paid record.
 */

import { ACCESS_RANK } from '@/lib/access/ranks';

export type SubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'unpaid'
  | 'paused'
  | 'canceled'
  | 'incomplete'
  | 'expired';

export type AccountStatus = 'active' | 'suspended' | 'closed';

export type UserRole =
  | 'visitor'
  | 'member'
  | 'researcher'
  | 'reviewer'
  | 'editor'
  | 'support_representative'
  | 'billing_manager'
  | 'super_administrator';

export const STAFF_ROLES: readonly UserRole[] = [
  'researcher',
  'reviewer',
  'editor',
  'support_representative',
  'billing_manager',
  'super_administrator',
];

export function isStaffRole(role: UserRole): boolean {
  return STAFF_ROLES.includes(role);
}

/**
 * Days a past-due subscription keeps paid access while Stripe retries the
 * payment. Mirrors public.past_due_grace_period().
 *
 * Rationale: Stripe's smart retries run for up to a week, and cutting a paying
 * customer off on the first failed charge generates support load out of
 * proportion to the revenue at risk. After the grace window the account falls
 * back to free — it is not suspended, and nothing saved is lost.
 */
export const PAST_DUE_GRACE_DAYS = 3;

export interface SubscriptionRecord {
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  planAccessRank: number;
}

export interface ProfileAccessInput {
  role: UserRole;
  accountStatus: AccountStatus;
  accessRankOverride: number | null;
  accessRankOverrideExpiresAt: Date | null;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * The rank earned by the subscription alone, ignoring role and any
 * administrative override.
 */
export function subscriptionAccessRank(
  subscription: SubscriptionRecord | null,
  now: Date = new Date(),
): number {
  if (!subscription) return ACCESS_RANK.free;

  const { status, currentPeriodEnd, planAccessRank } = subscription;

  switch (status) {
    case 'active':
    case 'trialing':
      // `cancel_at_period_end` does not reduce access: the member has paid
      // through the end of the period and keeps everything until it lapses.
      return planAccessRank;

    case 'past_due':
      // Stripe is still retrying. Keep access through the paid period plus the
      // grace window, then drop to free.
      if (!currentPeriodEnd) return planAccessRank;
      return now <= addDays(currentPeriodEnd, PAST_DUE_GRACE_DAYS)
        ? planAccessRank
        : ACCESS_RANK.free;

    case 'canceled':
      // Cancelled but already paid through the end of the period.
      if (!currentPeriodEnd) return ACCESS_RANK.free;
      return now <= currentPeriodEnd ? planAccessRank : ACCESS_RANK.free;

    // No paid access: 'free', 'unpaid', 'paused', 'incomplete', 'expired'.
    default:
      return ACCESS_RANK.free;
  }
}

/**
 * The rank the application enforces, taking account status, staff role and any
 * administrative override into account.
 */
export function effectiveAccessRank(
  profile: ProfileAccessInput,
  subscription: SubscriptionRecord | null,
  now: Date = new Date(),
): number {
  // A suspended or closed account keeps its saved records but loses every paid
  // capability — including staff previews (spec 9, "Suspended account rule").
  if (profile.accountStatus !== 'active') return ACCESS_RANK.free;

  if (isStaffRole(profile.role)) return ACCESS_RANK.staff;

  let rank = subscriptionAccessRank(subscription, now);

  const override = profile.accessRankOverride;
  if (override !== null) {
    const expiry = profile.accessRankOverrideExpiresAt;
    if (expiry === null || expiry > now) {
      rank = Math.max(rank, override);
    }
  }

  return rank;
}

/**
 * Maps a Stripe subscription status onto ours. Stripe's vocabulary is a near
 * match; the values it does not have (`free`, `expired`) are set by our own
 * lifecycle jobs rather than by a webhook.
 */
export function fromStripeStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
      return 'past_due';
    case 'unpaid':
      return 'unpaid';
    case 'paused':
      return 'paused';
    case 'canceled':
      return 'canceled';
    case 'incomplete':
    case 'incomplete_expired':
      return 'incomplete';
    default:
      return 'free';
  }
}

/** True when the member should be shown a "fix your payment" banner. */
export function needsPaymentAttention(
  subscription: SubscriptionRecord | null,
): boolean {
  if (!subscription) return false;
  return (
    subscription.status === 'past_due' ||
    subscription.status === 'unpaid' ||
    subscription.status === 'incomplete'
  );
}

/**
 * When paid access will end if nothing changes. Null means "not scheduled to
 * end" — an active subscription that will simply renew.
 */
export function paidAccessEndsAt(
  subscription: SubscriptionRecord | null,
): Date | null {
  if (!subscription) return null;
  const { status, currentPeriodEnd, cancelAtPeriodEnd } = subscription;
  if (!currentPeriodEnd) return null;

  if (status === 'canceled') return currentPeriodEnd;
  if (status === 'past_due')
    return addDays(currentPeriodEnd, PAST_DUE_GRACE_DAYS);
  if ((status === 'active' || status === 'trialing') && cancelAtPeriodEnd) {
    return currentPeriodEnd;
  }
  return null;
}
