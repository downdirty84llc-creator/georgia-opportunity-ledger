/**
 * Where an upgrade prompt was clicked.
 *
 * `upgrade_button_clicked` has been in `ANALYTICS_EVENTS` since the analytics
 * work landed, but nothing ever fired it — so the funnel recorded that a member
 * *saw* locked content and that they later *started checkout*, with nothing in
 * between. The question "which withheld feature actually drives an upgrade" was
 * therefore unanswerable, and telemetry cannot be backfilled onto traffic that
 * has already gone.
 *
 * The event is captured server-side when `/pricing` renders with a `from`
 * parameter, rather than from a click handler in the browser. That matches the
 * decision recorded in `docs/ARCHITECTURE.md` §12: analytics are captured on the
 * server precisely so an ad blocker cannot silently drop a funnel event. It also
 * means no new API surface, no client-side event queue, and no new dependency.
 *
 * The cost of doing it this way is that the signal counts *arrivals* at the
 * pricing page, not clicks — a refresh or a back-and-forward will re-fire it.
 * For a "which lock pushed people toward pricing" question, arrivals are the
 * more useful denominator anyway, but the distinction matters when reading the
 * numbers.
 *
 * The parameter is validated against this list before it reaches analytics, so
 * a hand-edited URL cannot write arbitrary strings into `analytics_events`.
 */

export const UPGRADE_SOURCES = [
  /** Whole record is above the viewer's tier. */
  'opportunity_locked',
  /** Record is readable but the deeper analysis is withheld. */
  'opportunity_partial',
  /** Whole report is above the viewer's tier. */
  'report_locked',
  /** Report is readable but a section is withheld. */
  'report_section',
  /** Deadline calendar, withheld below Weekly. */
  'deadline_calendar',
  /** The public sample report's own upgrade prompt. */
  'sample_report',
  /** CSV export, withheld below Detailed. */
  'csv_export',
  /** Saved-search limit reached or unavailable on this plan. */
  'saved_search',
  /** Saved-opportunity limit reached. */
  'saved_opportunity',
  /** The locked teaser on an opportunity card in a list. */
  'opportunity_card',
  /** Per-alert-type preferences, withheld below Premium. */
  'alert_preferences',
  /** The header's standing Upgrade button — no specific feature behind it. */
  'header',
] as const;

export type UpgradeSource = (typeof UPGRADE_SOURCES)[number];

export function isUpgradeSource(value: unknown): value is UpgradeSource {
  return (
    typeof value === 'string' &&
    (UPGRADE_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * Builds the pricing link that carries its own origin.
 *
 * `/pricing` sets a canonical URL of `/pricing`, so these parameters do not
 * fragment the page in search results.
 */
export function upgradeHref(
  source: UpgradeSource,
  requiredPlan?: string | null,
): string {
  const params = new URLSearchParams({ from: source });
  if (requiredPlan) params.set('plan', requiredPlan);
  return `/pricing?${params.toString()}`;
}
