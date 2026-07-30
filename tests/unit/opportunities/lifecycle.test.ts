import { describe, expect, it } from 'vitest';

import {
  CLOSING_SOON_DAYS,
  dueReminderInterval,
  evaluateLifecycle,
  isClosingSoon,
  isExpired,
  needsReverification,
  reminderDedupeKey,
  reverificationDueAt,
} from '@/lib/opportunities/lifecycle';

const NOW = new Date('2026-07-15T12:00:00Z');

describe('expiry and closing-soon (spec 26)', () => {
  it('a passed deadline is expired', () => {
    expect(isExpired(new Date('2026-07-14T00:00:00Z'), NOW)).toBe(true);
    expect(isExpired(new Date('2026-07-16T00:00:00Z'), NOW)).toBe(false);
    expect(isExpired(null, NOW)).toBe(false);
  });

  it('closing soon means within the window and not expired', () => {
    expect(isClosingSoon(new Date('2026-07-20T00:00:00Z'), NOW)).toBe(true);
    expect(isClosingSoon(new Date('2026-09-01T00:00:00Z'), NOW)).toBe(false);
    expect(isClosingSoon(new Date('2026-07-14T00:00:00Z'), NOW)).toBe(false);
  });

  it('the window matches the published constant', () => {
    const edge = new Date(NOW.getTime() + CLOSING_SOON_DAYS * 24 * 60 * 60 * 1000);
    expect(isClosingSoon(edge, NOW)).toBe(true);
  });

  it('information-only records never show closing soon', () => {
    expect(
      isClosingSoon(new Date('2026-07-20T00:00:00Z'), NOW, 'information_only'),
    ).toBe(false);
  });
});

describe('evaluateLifecycle transitions', () => {
  it('expires an open record whose deadline passed', () => {
    const result = evaluateLifecycle(
      { closingDate: new Date('2026-07-10T00:00:00Z'), status: 'open' },
      NOW,
    );
    expect(result.status).toBe('expired');
    expect(result.isExpired).toBe(true);
  });

  it('marks an open record closing soon', () => {
    const result = evaluateLifecycle(
      { closingDate: new Date('2026-07-22T00:00:00Z'), status: 'open' },
      NOW,
    );
    expect(result.status).toBe('closing_soon');
  });

  it('reopens when a deadline is extended outward', () => {
    const result = evaluateLifecycle(
      { closingDate: new Date('2026-10-01T00:00:00Z'), status: 'expired' },
      NOW,
    );
    expect(result.status).toBe('open');
    expect(result.isExpired).toBe(false);
  });

  it('a future opening date makes the record upcoming', () => {
    const result = evaluateLifecycle(
      {
        closingDate: new Date('2026-10-01T00:00:00Z'),
        openingDate: new Date('2026-08-01T00:00:00Z'),
        status: 'open',
      },
      NOW,
    );
    expect(result.status).toBe('upcoming');
  });

  it('never overrides administrator-controlled statuses', () => {
    for (const status of ['withdrawn', 'under_review', 'information_only', 'closed'] as const) {
      const result = evaluateLifecycle(
        { closingDate: new Date('2026-07-20T00:00:00Z'), status },
        NOW,
      );
      expect(result.status).toBe(status);
      expect(result.isClosingSoon).toBe(false);
    }
  });
});

describe('reverification (spec: 30-day cycle)', () => {
  it('falls due thirty days after verification', () => {
    const verified = new Date('2026-06-15T12:00:00Z');
    expect(reverificationDueAt(verified).toISOString()).toBe(
      '2026-07-15T12:00:00.000Z',
    );
    expect(needsReverification(verified, NOW)).toBe(true);
    expect(needsReverification(new Date('2026-07-01T00:00:00Z'), NOW)).toBe(false);
  });
});

describe('deadline reminder intervals (spec 16)', () => {
  it('picks the tightest interval the deadline has entered', () => {
    const inTwelveDays = new Date(NOW.getTime() + 12 * 24 * 60 * 60 * 1000);
    expect(dueReminderInterval(inTwelveDays, NOW)).toBe(14);

    const inSixDays = new Date(NOW.getTime() + 6 * 24 * 60 * 60 * 1000);
    expect(dueReminderInterval(inSixDays, NOW)).toBe(7);

    const inOneDay = new Date(NOW.getTime() + 26 * 60 * 60 * 1000);
    expect(dueReminderInterval(inOneDay, NOW)).toBe(2);

    const inTwoHours = new Date(NOW.getTime() + 2 * 60 * 60 * 1000);
    expect(dueReminderInterval(inTwoHours, NOW)).toBe(0);
  });

  it('returns null after the deadline and far before it', () => {
    expect(dueReminderInterval(new Date('2026-07-14T00:00:00Z'), NOW)).toBeNull();
    expect(dueReminderInterval(new Date('2026-10-01T00:00:00Z'), NOW)).toBeNull();
  });

  it('dedupe keys incorporate the deadline date', () => {
    const key = reminderDedupeKey('opp-1', new Date('2026-07-20T00:00:00Z'), 7);
    expect(key).toBe('deadline:opp-1:2026-07-20:7');
  });
});
