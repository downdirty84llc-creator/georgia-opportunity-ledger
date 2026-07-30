import { describe, expect, it } from 'vitest';

import { ACCESS_RANK } from '@/lib/access/ranks';
import {
  effectiveAccessRank,
  fromStripeStatus,
  paidAccessEndsAt,
  PAST_DUE_GRACE_DAYS,
  subscriptionAccessRank,
  type ProfileAccessInput,
  type SubscriptionRecord,
} from '@/lib/billing/subscription';

const NOW = new Date('2026-07-15T12:00:00Z');

const member: ProfileAccessInput = {
  role: 'member',
  accountStatus: 'active',
  accessRankOverride: null,
  accessRankOverrideExpiresAt: null,
};

function subscription(
  overrides: Partial<SubscriptionRecord>,
): SubscriptionRecord {
  return {
    status: 'active',
    currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    planAccessRank: ACCESS_RANK.premium,
    ...overrides,
  };
}

describe('subscriptionAccessRank (spec 9)', () => {
  it('grants the plan rank while active or trialing', () => {
    expect(subscriptionAccessRank(subscription({ status: 'active' }), NOW)).toBe(30);
    expect(subscriptionAccessRank(subscription({ status: 'trialing' }), NOW)).toBe(30);
  });

  it('keeps access after cancellation until the paid period ends', () => {
    const canceled = subscription({
      status: 'canceled',
      currentPeriodEnd: new Date('2026-07-31T00:00:00Z'),
    });
    expect(subscriptionAccessRank(canceled, NOW)).toBe(30);
    expect(
      subscriptionAccessRank(canceled, new Date('2026-08-01T00:00:01Z')),
    ).toBe(0);
  });

  it('cancel_at_period_end does not reduce access before the period ends', () => {
    const scheduled = subscription({ cancelAtPeriodEnd: true });
    expect(subscriptionAccessRank(scheduled, NOW)).toBe(30);
  });

  it('past_due keeps access through the grace window, then drops', () => {
    const pastDue = subscription({
      status: 'past_due',
      currentPeriodEnd: new Date('2026-07-14T00:00:00Z'),
    });
    // One day past the period end, inside the 3-day grace window.
    expect(subscriptionAccessRank(pastDue, NOW)).toBe(30);
    // Past the grace window.
    expect(
      subscriptionAccessRank(pastDue, new Date('2026-07-18T00:00:01Z')),
    ).toBe(0);
  });

  it('unpaid, paused, incomplete and expired grant nothing', () => {
    for (const status of ['unpaid', 'paused', 'incomplete', 'expired'] as const) {
      expect(subscriptionAccessRank(subscription({ status }), NOW)).toBe(0);
    }
  });

  it('a missing subscription is free', () => {
    expect(subscriptionAccessRank(null, NOW)).toBe(0);
  });
});

describe('effectiveAccessRank (spec 9)', () => {
  it('suspension removes paid access regardless of subscription', () => {
    expect(
      effectiveAccessRank(
        { ...member, accountStatus: 'suspended' },
        subscription({}),
        NOW,
      ),
    ).toBe(0);
  });

  it('suspension removes staff previews too', () => {
    expect(
      effectiveAccessRank(
        { ...member, role: 'editor', accountStatus: 'suspended' },
        null,
        NOW,
      ),
    ).toBe(0);
  });

  it('staff roles receive the staff rank irrespective of plan', () => {
    expect(
      effectiveAccessRank({ ...member, role: 'researcher' }, null, NOW),
    ).toBe(ACCESS_RANK.staff);
  });

  it('administrative override lifts a free member', () => {
    expect(
      effectiveAccessRank(
        {
          ...member,
          accessRankOverride: ACCESS_RANK.detailed,
          accessRankOverrideExpiresAt: new Date('2026-08-01T00:00:00Z'),
        },
        null,
        NOW,
      ),
    ).toBe(ACCESS_RANK.detailed);
  });

  it('an expired override grants nothing', () => {
    expect(
      effectiveAccessRank(
        {
          ...member,
          accessRankOverride: ACCESS_RANK.detailed,
          accessRankOverrideExpiresAt: new Date('2026-07-01T00:00:00Z'),
        },
        null,
        NOW,
      ),
    ).toBe(0);
  });

  it('the override never lowers a higher subscription rank', () => {
    expect(
      effectiveAccessRank(
        {
          ...member,
          accessRankOverride: ACCESS_RANK.weekly,
          accessRankOverrideExpiresAt: null,
        },
        subscription({}),
        NOW,
      ),
    ).toBe(ACCESS_RANK.premium);
  });
});

describe('fromStripeStatus', () => {
  it('maps every Stripe status onto ours', () => {
    expect(fromStripeStatus('active')).toBe('active');
    expect(fromStripeStatus('trialing')).toBe('trialing');
    expect(fromStripeStatus('past_due')).toBe('past_due');
    expect(fromStripeStatus('unpaid')).toBe('unpaid');
    expect(fromStripeStatus('paused')).toBe('paused');
    expect(fromStripeStatus('canceled')).toBe('canceled');
    expect(fromStripeStatus('incomplete')).toBe('incomplete');
    expect(fromStripeStatus('incomplete_expired')).toBe('incomplete');
    expect(fromStripeStatus('something_new')).toBe('free');
  });
});

describe('paidAccessEndsAt', () => {
  it('is null for a renewing subscription', () => {
    expect(paidAccessEndsAt(subscription({}))).toBeNull();
  });

  it('is the period end for a scheduled cancellation', () => {
    const scheduled = subscription({ cancelAtPeriodEnd: true });
    expect(paidAccessEndsAt(scheduled)).toEqual(scheduled.currentPeriodEnd);
  });

  it('adds the grace window for past_due', () => {
    const pastDue = subscription({
      status: 'past_due',
      currentPeriodEnd: new Date('2026-07-14T00:00:00Z'),
    });
    const ends = paidAccessEndsAt(pastDue);
    expect(ends?.getTime()).toBe(
      new Date('2026-07-14T00:00:00Z').getTime() +
        PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );
  });
});
