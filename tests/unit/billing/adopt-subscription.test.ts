import { describe, expect, it } from 'vitest';

import {
  ADOPTABLE_STATUSES,
  chooseSubscriptionToAdopt,
  subscriptionSearchQuery,
  type AdoptableSubscription,
} from '@/lib/billing/adopt-subscription';

/**
 * These cover the half that grants paid access without a webhook, so the tests
 * that matter are the refusals. A suite that only proved "an active
 * subscription is adopted" would pass against a version that adopted anything
 * Stripe returned — including another account's subscription, or one the
 * customer never paid for.
 *
 * The case this exists for: on 2026-10-13 a real payment's webhook events were
 * refused on a signature mismatch, Stripe treated the 400 as permanent, and
 * `sync-subscriptions` could not find the subscription because it only looked
 * at rows that already had a `stripe_subscription_id` — a column only the
 * webhook writes.
 */

const USER = '9030f26c-a77c-44a6-9272-4fcd71bd0440';
const OTHER = '482fba7e-b122-4d15-a44b-f64e9fc58620';

function sub(
  overrides: Partial<AdoptableSubscription> = {},
): AdoptableSubscription {
  return {
    id: 'sub_1',
    status: 'active',
    created: 1_790_000_000,
    metadata: { user_id: USER },
    ...overrides,
  };
}

describe('subscriptionSearchQuery', () => {
  it('builds a metadata query for a UUID', () => {
    expect(subscriptionSearchQuery(USER)).toBe(`metadata['user_id']:'${USER}'`);
  });

  it.each([
    "' or 1=1 --",
    `${USER}' or metadata['user_id']:'${OTHER}`,
    'not-a-uuid',
    '',
    `${USER} `,
  ])('refuses %j rather than interpolating it', (value) => {
    // The id goes into a query language, so it is validated rather than
    // escaped. Every caller passes a UUID from our own column; refusing
    // anything else keeps that true if a caller ever changes.
    expect(subscriptionSearchQuery(value)).toBeNull();
  });
});

describe('chooseSubscriptionToAdopt', () => {
  it('adopts an active subscription that names this account', () => {
    const decision = chooseSubscriptionToAdopt([sub()], USER);

    expect(decision.chosen?.id).toBe('sub_1');
    expect(decision.ambiguous).toBe(false);
  });

  it('never adopts a subscription belonging to another account', () => {
    // The search query already filters on metadata, but Stripe's search is
    // eventually consistent and its query language is not this function's
    // contract. Granting paid access must not depend on a remote filter.
    const decision = chooseSubscriptionToAdopt(
      [sub({ metadata: { user_id: OTHER } })],
      USER,
    );

    expect(decision.chosen).toBeNull();
    expect(decision.eligible).toBe(0);
  });

  it('never adopts a subscription with no user_id metadata at all', () => {
    // A subscription created outside our checkout — by hand in the Dashboard,
    // or by the other business on a shared account — carries no user_id.
    const cases: Array<Record<string, string> | null | undefined> = [
      null,
      undefined,
      {},
      { plan_code: 'weekly' },
    ];
    for (const metadata of cases) {
      const decision = chooseSubscriptionToAdopt([sub({ metadata })], USER);
      expect(decision.chosen).toBeNull();
    }
  });

  it.each(['canceled', 'incomplete', 'incomplete_expired', 'paused'])(
    'does not adopt a %s subscription',
    (status) => {
      // `incomplete` is the one worth naming: the customer never completed
      // payment, so adopting it would record a subscription that was never
      // owed and hand over access for it.
      const decision = chooseSubscriptionToAdopt([sub({ status })], USER);

      expect(decision.chosen).toBeNull();
    },
  );

  it.each(['active', 'trialing', 'past_due', 'unpaid'])(
    'adopts a %s subscription',
    (status) => {
      // past_due and unpaid carry entitlement through the grace window, and
      // expire-lapsed-access needs the row to exist before it can expire it.
      expect(
        chooseSubscriptionToAdopt([sub({ status })], USER).chosen,
      ).not.toBeNull();
    },
  );

  it('keeps ADOPTABLE_STATUSES and the adopted set in agreement', () => {
    // Guards against someone adding a status to the set without thinking about
    // whether it has been paid for.
    expect([...ADOPTABLE_STATUSES].sort()).toEqual([
      'active',
      'past_due',
      'trialing',
      'unpaid',
    ]);
  });

  it('chooses the newest when several qualify, and says it was ambiguous', () => {
    // Two live subscriptions for one account is a billing fault of its own.
    // Access is not withheld, but the caller logs it rather than letting a
    // reconciler settle it silently.
    const decision = chooseSubscriptionToAdopt(
      [
        sub({ id: 'sub_old', created: 1_000 }),
        sub({ id: 'sub_new', created: 2_000 }),
        sub({ id: 'sub_mid', created: 1_500 }),
      ],
      USER,
    );

    expect(decision.chosen?.id).toBe('sub_new');
    expect(decision.eligible).toBe(3);
    expect(decision.ambiguous).toBe(true);
  });

  it('is not ambiguous when the extra candidates were ineligible', () => {
    const decision = chooseSubscriptionToAdopt(
      [
        sub({ id: 'sub_live', created: 1_000 }),
        sub({ id: 'sub_dead', created: 2_000, status: 'canceled' }),
        sub({ id: 'sub_theirs', created: 3_000, metadata: { user_id: OTHER } }),
      ],
      USER,
    );

    expect(decision.chosen?.id).toBe('sub_live');
    expect(decision.ambiguous).toBe(false);
  });

  it('returns nothing for an empty answer', () => {
    expect(chooseSubscriptionToAdopt([], USER)).toEqual({
      chosen: null,
      eligible: 0,
      ambiguous: false,
    });
  });
});
