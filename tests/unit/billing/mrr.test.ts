import { describe, expect, it } from 'vitest';

import {
  annualisedCents,
  centsToDollars,
  monthlyRecurringRevenue,
  type MrrSubscription,
} from '@/lib/billing/mrr';

/**
 * Prices from supabase/seed.sql. Kept literal rather than imported so that a
 * change to the seed shows up here as a deliberate decision about revenue
 * rather than silently re-baselining the expected numbers.
 */
const PLANS = {
  weekly: { monthlyPrice: 15, annualPrice: 150 },
  detailed: { monthlyPrice: 39, annualPrice: 390 },
  premium: { monthlyPrice: 99, annualPrice: 990 },
} as const;

const monthly = (plan: keyof typeof PLANS): MrrSubscription => ({
  billingInterval: 'monthly',
  ...PLANS[plan],
});

const annual = (plan: keyof typeof PLANS): MrrSubscription => ({
  billingInterval: 'annual',
  ...PLANS[plan],
});

describe('monthlyRecurringRevenue — monthly subscribers', () => {
  it('counts each paid tier at its monthly price', () => {
    expect(monthlyRecurringRevenue([monthly('weekly')]).cents).toBe(1500);
    expect(monthlyRecurringRevenue([monthly('detailed')]).cents).toBe(3900);
    expect(monthlyRecurringRevenue([monthly('premium')]).cents).toBe(9900);
  });

  it('sums a mixed set of monthly subscribers', () => {
    const total = monthlyRecurringRevenue([
      monthly('weekly'),
      monthly('detailed'),
      monthly('premium'),
    ]);
    expect(total.cents).toBe(15300);
    expect(centsToDollars(total.cents)).toBe(153);
    expect(total.counted).toBe(3);
  });
});

describe('monthlyRecurringRevenue — annual subscribers', () => {
  it('counts each paid tier at one twelfth of its annual price', () => {
    // This is the bug the module exists to fix: these were previously counted
    // at the monthly price, overstating an annual Premium subscriber by $16.50
    // a month.
    expect(monthlyRecurringRevenue([annual('weekly')]).cents).toBe(1250);
    expect(monthlyRecurringRevenue([annual('detailed')]).cents).toBe(3250);
    expect(monthlyRecurringRevenue([annual('premium')]).cents).toBe(8250);
  });

  it('does not count an annual subscriber at the monthly price', () => {
    const premiumAnnual = monthlyRecurringRevenue([annual('premium')]).cents;
    const premiumMonthly = monthlyRecurringRevenue([monthly('premium')]).cents;
    expect(premiumAnnual).toBeLessThan(premiumMonthly);
    expect(premiumMonthly - premiumAnnual).toBe(1650);
  });

  it('sums a mixed set of monthly and annual subscribers', () => {
    const total = monthlyRecurringRevenue([
      monthly('premium'),
      annual('premium'),
      monthly('weekly'),
      annual('detailed'),
    ]);
    // 9900 + 8250 + 1500 + 3250
    expect(total.cents).toBe(22900);
    expect(total.counted).toBe(4);
    expect(total.unresolvedIntervals).toBe(0);
  });
});

describe('monthlyRecurringRevenue — rounding', () => {
  it('rounds once at the end rather than once per subscription', () => {
    // $100/year is 833.33… cents a month. Twelve such subscribers contribute
    // exactly $100/month between them. Rounding per row would give
    // 12 × 833 = 9996 cents and lose four cents; rounding once gives 10000.
    const subscriber: MrrSubscription = {
      billingInterval: 'annual',
      monthlyPrice: 0,
      annualPrice: 100,
    };
    const total = monthlyRecurringRevenue(Array(12).fill(subscriber));
    expect(total.cents).toBe(10000);
  });

  it('rounds half up on the final division', () => {
    // 1250 annual cents / 12 = 104.1666… -> 104.
    expect(
      monthlyRecurringRevenue([
        { billingInterval: 'annual', monthlyPrice: 0, annualPrice: 12.5 },
      ]).cents,
    ).toBe(104);
    // 1750 / 12 = 145.83… -> 146.
    expect(
      monthlyRecurringRevenue([
        { billingInterval: 'annual', monthlyPrice: 0, annualPrice: 17.5 },
      ]).cents,
    ).toBe(146);
  });

  it('keeps cents exact for prices that divide evenly', () => {
    // $990/12 is exactly $82.50 and must not drift through a float.
    expect(monthlyRecurringRevenue([annual('premium')]).cents).toBe(8250);
    expect(centsToDollars(8250)).toBe(82.5);
  });
});

describe('monthlyRecurringRevenue — unrecognised billing interval', () => {
  it('reads a null interval as monthly, matching the column default', () => {
    // Deliberate: contributing zero would assert that a subscriber with an
    // active subscription pays nothing, hiding a real customer. The column is
    // `not null default 'monthly'`, so monthly is the schema's own answer for
    // "unspecified".
    const total = monthlyRecurringRevenue([
      { billingInterval: null, ...PLANS.premium },
    ]);
    expect(total.cents).toBe(9900);
  });

  it('reads an undefined or unknown interval as monthly too', () => {
    expect(
      monthlyRecurringRevenue([{ billingInterval: undefined, ...PLANS.weekly }])
        .cents,
    ).toBe(1500);
    expect(
      monthlyRecurringRevenue([
        { billingInterval: 'quarterly', ...PLANS.weekly },
      ]).cents,
    ).toBe(1500);
  });

  it('reports the fallback rather than applying it silently', () => {
    // Non-zero here means look at the data, not at the calculation.
    const total = monthlyRecurringRevenue([
      monthly('weekly'),
      { billingInterval: null, ...PLANS.premium },
      { billingInterval: 'quarterly', ...PLANS.detailed },
      annual('premium'),
    ]);
    expect(total.unresolvedIntervals).toBe(2);
    expect(total.counted).toBe(4);
  });

  it('leaves a resolved interval unflagged', () => {
    expect(
      monthlyRecurringRevenue([monthly('weekly'), annual('premium')])
        .unresolvedIntervals,
    ).toBe(0);
  });
});

describe('monthlyRecurringRevenue — missing and malformed data', () => {
  it('is zero for no subscribers', () => {
    const total = monthlyRecurringRevenue([]);
    expect(total.cents).toBe(0);
    expect(total.counted).toBe(0);
    expect(total.unresolvedIntervals).toBe(0);
  });

  it('accepts numeric columns handed back as strings', () => {
    // PostgREST can serialise `numeric` either way; the dashboard must not
    // depend on which.
    expect(
      monthlyRecurringRevenue([
        { billingInterval: 'annual', monthlyPrice: '99', annualPrice: '990' },
      ]).cents,
    ).toBe(8250);
    expect(
      monthlyRecurringRevenue([
        { billingInterval: 'monthly', monthlyPrice: '15', annualPrice: '150' },
      ]).cents,
    ).toBe(1500);
  });

  it('contributes nothing for a plan row that did not come back', () => {
    // A dashboard missing one row is better than a dashboard that renders no
    // numbers at all.
    const total = monthlyRecurringRevenue([
      { billingInterval: 'monthly', monthlyPrice: null, annualPrice: null },
      monthly('premium'),
    ]);
    expect(total.cents).toBe(9900);
  });

  it('ignores a non-numeric price rather than producing NaN', () => {
    const total = monthlyRecurringRevenue([
      { billingInterval: 'annual', monthlyPrice: 99, annualPrice: 'free' },
      annual('premium'),
    ]);
    expect(Number.isFinite(total.cents)).toBe(true);
    expect(total.cents).toBe(8250);
  });
});

describe('annualisedCents', () => {
  it('multiplies a monthly plan by twelve and takes an annual plan as-is', () => {
    expect(annualisedCents(monthly('premium')).cents).toBe(118800);
    expect(annualisedCents(annual('premium')).cents).toBe(99000);
  });

  it('reports whether the interval was recognised', () => {
    expect(annualisedCents(monthly('weekly')).intervalResolved).toBe(true);
    expect(annualisedCents(annual('weekly')).intervalResolved).toBe(true);
    expect(
      annualisedCents({ billingInterval: null, ...PLANS.weekly })
        .intervalResolved,
    ).toBe(false);
  });
});
