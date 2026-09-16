import { describe, expect, it } from 'vitest';

import {
  canCancelDeletion,
  daysUntilPurge,
  DELETION_GRACE_DAYS,
  isDeletionPending,
  isPurgeDue,
  purgeDueAt,
} from '@/lib/account/deletion';

/**
 * The deletion grace window.
 *
 * Getting the boundary wrong in either direction is expensive: too early and
 * an account is destroyed while the member still believes they can undo it;
 * too late and a deletion request is never honoured.
 */

const day = 24 * 60 * 60 * 1000;
const requested = new Date('2026-08-01T12:00:00.000Z');
const at = (days: number) => new Date(requested.getTime() + days * day);

describe('deletion grace window', () => {
  it('schedules the purge exactly the grace period after the request', () => {
    expect(purgeDueAt(requested).toISOString()).toBe(
      at(DELETION_GRACE_DAYS).toISOString(),
    );
  });

  it('treats an account with no request as neither pending nor due', () => {
    const state = { requestedAt: null, accountStatus: 'active' as const };
    expect(isDeletionPending(state)).toBe(false);
    expect(isPurgeDue(state)).toBe(false);
    expect(canCancelDeletion(state)).toBe(false);
  });

  it('keeps the request pending, and cancellable, throughout the window', () => {
    const state = { requestedAt: requested, accountStatus: 'closed' as const };
    for (const days of [0, 1, 15, DELETION_GRACE_DAYS - 1]) {
      expect(isDeletionPending(state, at(days))).toBe(true);
      expect(isPurgeDue(state, at(days))).toBe(false);
      expect(canCancelDeletion(state, at(days))).toBe(true);
    }
  });

  it('becomes due at the boundary, not a day late', () => {
    const state = { requestedAt: requested, accountStatus: 'closed' as const };
    const boundary = at(DELETION_GRACE_DAYS);

    expect(isPurgeDue(state, boundary)).toBe(true);
    expect(isDeletionPending(state, boundary)).toBe(false);
    // Once the purge is due there is nothing left to withdraw.
    expect(canCancelDeletion(state, boundary)).toBe(false);
  });

  it('stays due afterwards, so a missed job run still purges', () => {
    const state = { requestedAt: requested, accountStatus: 'closed' as const };
    expect(isPurgeDue(state, at(DELETION_GRACE_DAYS + 90))).toBe(true);
  });

  it('counts down whole days remaining and floors at zero', () => {
    expect(daysUntilPurge(requested, requested)).toBe(DELETION_GRACE_DAYS);
    expect(daysUntilPurge(requested, at(29))).toBe(1);
    expect(daysUntilPurge(requested, at(DELETION_GRACE_DAYS))).toBe(0);
    expect(daysUntilPurge(requested, at(DELETION_GRACE_DAYS + 5))).toBe(0);
  });

  it('rounds a part-day up, so "1 day left" never means minutes', () => {
    const almost = new Date(at(DELETION_GRACE_DAYS).getTime() - 1000);
    expect(daysUntilPurge(requested, almost)).toBe(1);
  });
});
