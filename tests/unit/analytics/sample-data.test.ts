import { describe, expect, it } from 'vitest';

import {
  countsTowardAnalytics,
  excludeSampleUsersFilter,
  sampleUserIdList,
} from '@/lib/analytics/sample-data';

const SAMPLE_A = '11111111-1111-4111-8111-111111111111';
const SAMPLE_B = '22222222-2222-4222-8222-222222222222';
const REAL = '33333333-3333-4333-8333-333333333333';

const sampleIds = new Set([SAMPLE_A, SAMPLE_B]);

describe('countsTowardAnalytics', () => {
  it('counts a real signed-in member', () => {
    expect(countsTowardAnalytics(REAL, sampleIds)).toBe(true);
  });

  it('does not count a seeded demo account', () => {
    expect(countsTowardAnalytics(SAMPLE_A, sampleIds)).toBe(false);
    expect(countsTowardAnalytics(SAMPLE_B, sampleIds)).toBe(false);
  });

  it('counts anonymous events, which are real visitors', () => {
    // The whole point of the funnel is signed-out traffic. Dropping these
    // would be a far bigger error than the one this module exists to fix.
    expect(countsTowardAnalytics(null, sampleIds)).toBe(true);
    expect(countsTowardAnalytics(undefined, sampleIds)).toBe(true);
    expect(countsTowardAnalytics('', sampleIds)).toBe(true);
  });

  it('counts everything when nothing is flagged as sample, as in production', () => {
    const none = new Set<string>();
    expect(countsTowardAnalytics(REAL, none)).toBe(true);
    expect(countsTowardAnalytics(SAMPLE_A, none)).toBe(true);
    expect(countsTowardAnalytics(null, none)).toBe(true);
  });
});

describe('sampleUserIdList', () => {
  it('renders a PostgREST in-list', () => {
    expect(sampleUserIdList([SAMPLE_A, SAMPLE_B])).toBe(
      `(${SAMPLE_A},${SAMPLE_B})`,
    );
  });

  it('rejects anything that is not a uuid rather than dropping it', () => {
    // Dropping it would under-filter and let sample data back into the
    // numbers — the exact failure this module exists to prevent.
    expect(() => sampleUserIdList([SAMPLE_A, 'not-a-uuid'])).toThrow(
      /not a uuid/,
    );
    expect(() => sampleUserIdList(['1);drop table profiles;--'])).toThrow(
      /not a uuid/,
    );
  });
});

describe('sampleUserIdList — the shape the subscriber tiles depend on', () => {
  // The admin dashboard hands this to `.not('user_id', 'in', …)` for the
  // subscriber count, MRR and failed-payment tiles. PostgREST wants a
  // parenthesised, comma-joined list with no padding; if the shape drifts, all
  // three tiles stop excluding sample accounts without failing loudly.
  it('is parenthesised, comma-joined and unpadded', () => {
    const rendered = sampleUserIdList([SAMPLE_A, SAMPLE_B]);
    expect(rendered.startsWith('(')).toBe(true);
    expect(rendered.endsWith(')')).toBe(true);
    expect(rendered).not.toMatch(/\s/);
    expect(rendered.slice(1, -1).split(',')).toEqual([SAMPLE_A, SAMPLE_B]);
  });

  it('renders a single id without a trailing separator', () => {
    expect(sampleUserIdList([SAMPLE_A])).toBe(`(${SAMPLE_A})`);
  });

  it('drops no ids — every sample account reaches the filter', () => {
    const ids = [SAMPLE_A, SAMPLE_B, REAL];
    const rendered = sampleUserIdList(ids);
    for (const id of ids) expect(rendered).toContain(id);
  });
});

describe('excludeSampleUsersFilter', () => {
  it('returns null when there is nothing to exclude', () => {
    // PostgREST reads `in.()` as a syntax error, so the caller must skip the
    // filter rather than apply an empty one. Production is this case.
    expect(excludeSampleUsersFilter([])).toBeNull();
  });

  it('keeps anonymous rows and excludes the sample users', () => {
    expect(excludeSampleUsersFilter([SAMPLE_A, SAMPLE_B])).toBe(
      `user_id.is.null,user_id.not.in.(${SAMPLE_A},${SAMPLE_B})`,
    );
  });

  it('never emits a bare not.in, which would drop anonymous rows', () => {
    // `null not in (…)` is null in SQL, and PostgREST drops a null predicate.
    // A filter without the `is.null` branch would silently delete every
    // signed-out event from the aggregate.
    const filter = excludeSampleUsersFilter([SAMPLE_A]);
    expect(filter).not.toBeNull();
    expect(filter!.startsWith('user_id.is.null,')).toBe(true);
  });

  it('agrees with countsTowardAnalytics about who is excluded', () => {
    // The predicate is the readable statement of the rule and the filter is
    // the one that actually runs. They are only useful if they say the same
    // thing, so assert that rather than trusting the reader to compare them.
    const ids = [SAMPLE_A, SAMPLE_B];
    const filter = excludeSampleUsersFilter(ids)!;
    const excludedByFilter = (userId: string | null) =>
      userId !== null && filter.includes(userId);

    for (const userId of [SAMPLE_A, SAMPLE_B, REAL, null]) {
      expect(excludedByFilter(userId)).toBe(
        !countsTowardAnalytics(userId, new Set(ids)),
      );
    }
  });
});
