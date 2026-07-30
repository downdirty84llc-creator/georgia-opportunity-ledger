import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLAN_FEATURE_DEFAULTS, PLAN_RANK } from '@/lib/access/ranks';

/**
 * Guards against the two copies of the plan matrix drifting apart: the
 * compiled defaults in src/lib/access/ranks.ts and the seeded
 * feature_configuration documents in supabase/seed.sql.
 *
 * The seed file is parsed textually rather than executed — crude, but it means
 * the check runs in CI with no database.
 */

const seedSql = readFileSync(
  join(__dirname, '../../../supabase/seed.sql'),
  'utf8',
);

function seededValue(planBlock: string, key: string): string | null {
  const match = planBlock.match(new RegExp(`'${key}',\\s*([^,\\n)]+)`));
  return match?.[1]?.trim() ?? null;
}

function blockFor(code: string): string {
  const start = seedSql.indexOf(`'${code}',`);
  expect(start, `plan '${code}' present in seed.sql`).toBeGreaterThan(-1);
  const end = seedSql.indexOf('jsonb_build_object', start);
  const close = seedSql.indexOf(')\n)', end);
  return seedSql.slice(start, close === -1 ? seedSql.length : close);
}

describe('plan matrix parity (code vs seed)', () => {
  for (const [code, features] of Object.entries(PLAN_FEATURE_DEFAULTS)) {
    describe(`${code} plan`, () => {
      const block = blockFor(code);

      it('saved-opportunity limit matches', () => {
        const seeded = seededValue(block, 'savedOpportunityLimit');
        const expected =
          features.savedOpportunityLimit === null
            ? 'null'
            : String(features.savedOpportunityLimit);
        expect(seeded).toBe(expected);
      });

      it('saved-search limit matches', () => {
        const seeded = seededValue(block, 'savedSearchLimit');
        const expected =
          features.savedSearchLimit === null
            ? 'null'
            : String(features.savedSearchLimit);
        expect(seeded).toBe(expected);
      });

      it('boolean capabilities match', () => {
        for (const key of [
          'csvExport',
          'immediateAlerts',
          'advancedFilters',
          'deadlineCalendar',
          'weeklyReports',
          'premiumBriefing',
          'completeDatabaseAccess',
        ] as const) {
          expect(seededValue(block, key), key).toBe(String(features[key]));
        }
      });

      it('detail levels match', () => {
        expect(seededValue(block, 'opportunityDetail')).toBe(
          `'${features.opportunityDetail}'`,
        );
        expect(seededValue(block, 'pricingDashboard')).toBe(
          `'${features.pricingDashboard}'`,
        );
      });

      it('page size matches', () => {
        expect(seededValue(block, 'maxPageSize')).toBe(
          String(features.maxPageSize),
        );
      });
    });
  }

  it('access ranks in seed match the compiled ranks', () => {
    // Rank appears as the third numeric field after the two prices, e.g.
    // "0, 0, 0, 1, false" for free or "15, 150, 10, 2, false" for weekly.
    for (const [code, rank] of Object.entries(PLAN_RANK)) {
      const block = blockFor(code);
      const priceLine = block.match(/\n\s*([\d.]+), ([\d.]+), (\d+), \d+, (?:true|false)/);
      expect(priceLine, `${code} pricing line`).not.toBeNull();
      expect(Number(priceLine?.[3]), `${code} access rank`).toBe(rank);
    }
  });
});
