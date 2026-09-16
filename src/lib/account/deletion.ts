/**
 * Account deletion (Privacy Policy, "Your controls").
 *
 * The policy says a deletion request "removes your profile, preferences, saved
 * records and saved searches" while "billing records are retained where we are
 * required to keep them". Both halves fall out of the foreign keys rather than
 * from a hand-written list of tables to empty, which is the only version of
 * this that stays correct when a table is added later:
 *
 *   - Deleting the `auth.users` row cascades to `profiles`, and from there to
 *     `user_preferences`, `saved_opportunities`, `saved_searches`,
 *     `alert_preferences`, `notifications`, `export_jobs` and `subscriptions`.
 *   - `audit_logs`, `billing_events`, `analytics_events`, `support_tickets`
 *     and `correction_requests` are `on delete set null`, so they survive
 *     de-identified. The append-only audit trail is not rewritten by someone
 *     closing their account.
 *
 * The `subscriptions` row goes with the cascade, and that is deliberate:
 * Stripe is the system of record for anything with a tax or accounting
 * obligation. What remains here is `billing_events`, the webhook ledger, with
 * the member no longer named in it.
 *
 * Deletion is **not** immediate. Access stops at once — the account is closed,
 * and `effective_access_rank` returns 0 for any account that is not active —
 * but the data survives a grace window so that a mistake, or someone else's
 * malice, is recoverable. Only after the window does the purge run, and then
 * it cannot be undone.
 */

export const DELETION_GRACE_DAYS = 30;

export interface DeletionState {
  requestedAt: Date | null;
  accountStatus: 'active' | 'suspended' | 'closed';
}

/** When a request made at this moment becomes permanent. */
export function purgeDueAt(requestedAt: Date): Date {
  return new Date(
    requestedAt.getTime() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
  );
}

export function isDeletionPending(
  state: DeletionState,
  now: Date = new Date(),
): boolean {
  if (!state.requestedAt) return false;
  return purgeDueAt(state.requestedAt) > now;
}

export function isPurgeDue(
  state: DeletionState,
  now: Date = new Date(),
): boolean {
  if (!state.requestedAt) return false;
  return purgeDueAt(state.requestedAt) <= now;
}

/** Days left before the request becomes irreversible; 0 once it is due. */
export function daysUntilPurge(
  requestedAt: Date,
  now: Date = new Date(),
): number {
  const remaining = purgeDueAt(requestedAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
}

/**
 * A request can be withdrawn right up to the moment the purge runs. After
 * that there is no account left to withdraw it for.
 */
export function canCancelDeletion(
  state: DeletionState,
  now: Date = new Date(),
): boolean {
  return isDeletionPending(state, now);
}
