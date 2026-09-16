import { describe, expect, it } from 'vitest';

import {
  UPGRADE_SOURCES,
  isUpgradeSource,
  upgradeHref,
} from '@/lib/analytics/upgrade-source';

/**
 * `from` and `plan` arrive from a URL, so anyone can type anything into them.
 * The guard is what stops that reaching `analytics_events`, which makes it a
 * validation boundary rather than a formatting helper.
 */

describe('isUpgradeSource', () => {
  it('accepts every declared source', () => {
    for (const source of UPGRADE_SOURCES) {
      expect(isUpgradeSource(source)).toBe(true);
    }
  });

  it('rejects an unknown string', () => {
    expect(isUpgradeSource('free_money')).toBe(false);
    expect(isUpgradeSource('')).toBe(false);
  });

  it('rejects non-strings, including the shapes a query string can produce', () => {
    // Next hands back string[] for a repeated parameter and undefined when it
    // is absent; neither may be treated as a source.
    expect(isUpgradeSource(undefined)).toBe(false);
    expect(isUpgradeSource(['csv_export'])).toBe(false);
    expect(isUpgradeSource(null)).toBe(false);
    expect(isUpgradeSource(42)).toBe(false);
    expect(isUpgradeSource({ toString: () => 'csv_export' })).toBe(false);
  });

  it('does not accept a source by prefix or case', () => {
    expect(isUpgradeSource('csv_export ')).toBe(false);
    expect(isUpgradeSource('CSV_EXPORT')).toBe(false);
    expect(isUpgradeSource('csv_export;drop')).toBe(false);
  });
});

describe('upgradeHref', () => {
  it('carries the source', () => {
    expect(upgradeHref('csv_export')).toBe('/pricing?from=csv_export');
  });

  it('adds the required plan when one is known', () => {
    expect(upgradeHref('opportunity_locked', 'detailed')).toBe(
      '/pricing?from=opportunity_locked&plan=detailed',
    );
  });

  it('omits the plan when it is absent rather than emitting an empty one', () => {
    // An empty `plan=` would be recorded as a distinct value from "unknown",
    // which would quietly split the funnel in two.
    expect(upgradeHref('header', null)).toBe('/pricing?from=header');
    expect(upgradeHref('header', '')).toBe('/pricing?from=header');
  });

  it('escapes anything unexpected in the plan', () => {
    expect(upgradeHref('header', 'a&b=c')).toBe(
      '/pricing?from=header&plan=a%26b%3Dc',
    );
  });
});
