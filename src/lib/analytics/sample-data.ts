/**
 * Keeping demo activity out of the numbers the business is run on.
 *
 * The seeder flags every profile, opportunity, indicator value and report it
 * writes with `is_sample = true`, and that flag has always driven the UI badge
 * and the CSV export. It did not drive the admin dashboard's subscriber count,
 * its MRR, or the daily analytics aggregate — so three seeded demo
 * subscriptions (weekly, detailed, premium) added $153 of imaginary monthly
 * revenue to a staging dashboard, and every demo login inflated the event
 * counts. The documentation had claimed this exclusion existed for long enough
 * that nobody checked.
 *
 * Two things are needed, and the point of putting them in one module is that
 * they must agree:
 *
 * - `countsTowardAnalytics`, the rule stated once, in a form a test can reach
 *   without a database.
 * - `excludeSampleUsersFilter` / `sampleUserIdList`, the same rule pushed into
 *   the query, because filtering twenty thousand rows in Node after fetching
 *   them is not filtering, it is downloading.
 *
 * The rule itself has one subtlety worth stating: an event with no `user_id`
 * is anonymous traffic from a real visitor, and must be *kept*. That is why
 * this cannot be a bare `not.in` — in SQL, `null not in (…)` is null, which
 * PostgREST drops. Getting that backwards would silently delete every
 * signed-out event from the funnel, which is precisely the metric the funnel
 * exists to measure.
 */

/** Matches the canonical 8-4-4-4-12 hexadecimal form. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Does this event belong in the aggregate?
 *
 * Anonymous events count — they are real visitors. Events attributed to a
 * seeded profile do not.
 */
export function countsTowardAnalytics(
  userId: string | null | undefined,
  sampleUserIds: ReadonlySet<string>,
): boolean {
  if (!userId) return true;
  return !sampleUserIds.has(userId);
}

/**
 * Renders ids into a PostgREST `in` list.
 *
 * A malformed id throws rather than being dropped. These come from our own
 * `uuid` column, so a bad one is a bug somewhere upstream, and the failure
 * modes of the alternatives are both worse: dropping it silently under-filters
 * (sample data leaks back into the numbers), and interpolating it blindly puts
 * caller-shaped text into a filter expression.
 *
 * The exact output shape matters and is pinned by a test: the admin dashboard
 * passes it to `.not('user_id', 'in', …)` for the subscriber, revenue and
 * failed-payment tiles, and all three stop filtering silently if it drifts.
 *
 * Note the deliberate asymmetry with `excludeSampleUsersFilter` below, which
 * exists because the two tables mean different things by a null `user_id`.
 * `subscriptions.user_id` is `not null`, so a bare `not.in` — which drops nulls
 * — is correct there. `analytics_events.user_id` is nullable and a null means
 * anonymous traffic from a real visitor, which must be kept. Do not unify
 * these: one of the two tiles would start lying.
 */
export function sampleUserIdList(sampleUserIds: readonly string[]): string {
  for (const id of sampleUserIds) {
    if (!UUID_PATTERN.test(id)) {
      throw new Error(`sample profile id is not a uuid: ${JSON.stringify(id)}`);
    }
  }
  return `(${sampleUserIds.join(',')})`;
}

/**
 * The `or(...)` expression that applies `countsTowardAnalytics` inside the
 * database, for tables whose `user_id` is nullable.
 *
 * Returns `null` when there is nothing to exclude — the caller must then skip
 * the filter entirely rather than pass an empty list, because PostgREST reads
 * `in.()` as a syntax error. In production there are no sample profiles at
 * all, so `null` is the expected answer there and the query is left untouched.
 */
export function excludeSampleUsersFilter(
  sampleUserIds: readonly string[],
): string | null {
  if (sampleUserIds.length === 0) return null;
  return `user_id.is.null,user_id.not.in.${sampleUserIdList(sampleUserIds)}`;
}
