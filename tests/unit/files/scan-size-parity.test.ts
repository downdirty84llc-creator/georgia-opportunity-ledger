import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guards the upload ceiling against drifting between its three homes: the
 * default in src/lib/env.ts, the documented value in .env.example, and the
 * literals the durable-scan migration compares file_size against.
 *
 * The migration cannot read an environment variable, so the number is written
 * into it. That is fine until somebody raises MAX_UPLOAD_BYTES: uploads over
 * the migration's ceiling then succeed, while pending_attachment_scans() and
 * claim_attachment_scan() silently skip them. Such a file stays `pending`
 * forever — never scanned, so never servable, and nothing anywhere reports it.
 * Fail-closed, which is the right direction, but invisible.
 *
 * Parsed textually rather than executed, like the plan-matrix parity check, so
 * it runs in CI with no database and no environment.
 */

/** The one place this number is decided. Change it here and in all three. */
const MAX_UPLOAD_BYTES = 26_214_400;

function read(...parts: string[]): string {
  return readFileSync(join(__dirname, '../../../', ...parts), 'utf8');
}

describe('upload ceiling parity', () => {
  it('matches the default in src/lib/env.ts', () => {
    const env = read('src/lib/env.ts');
    const match = /MAX_UPLOAD_BYTES\s*\?\?\s*([0-9_]+)/.exec(env);

    expect(
      match,
      'no MAX_UPLOAD_BYTES default found in src/lib/env.ts',
    ).not.toBeNull();
    expect(Number(match?.[1]?.replaceAll('_', ''))).toBe(MAX_UPLOAD_BYTES);
  });

  it('matches the documented value in .env.example', () => {
    const example = read('.env.example');
    const match = /MAX_UPLOAD_BYTES="?([0-9]+)"?/.exec(example);

    expect(
      match,
      'no MAX_UPLOAD_BYTES line found in .env.example',
    ).not.toBeNull();
    expect(Number(match?.[1])).toBe(MAX_UPLOAD_BYTES);
  });

  it('matches every file_size bound in the durable-scan migration', () => {
    const migration = read(
      'supabase/migrations/20261026140000_durable_attachment_scans.sql',
    );
    const bounds = [
      ...migration.matchAll(/file_size\s+between\s+1\s+and\s+([0-9]+)/g),
    ].map((m) => Number(m[1]));

    // Three today: the table's check constraint, and the two functions that
    // decide which attachments a worker may pick up. The count is asserted so
    // that a fourth copy added later is noticed rather than silently unchecked.
    expect(bounds).toHaveLength(3);
    for (const bound of bounds) expect(bound).toBe(MAX_UPLOAD_BYTES);
  });

  it('holds for every file_size bound in every migration', () => {
    // A later migration comparing file_size needs the same ceiling, and would
    // otherwise be checked by nobody.
    const dir = join(__dirname, '../../../supabase/migrations');
    const offenders: string[] = [];

    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
      const sql = readFileSync(join(dir, file), 'utf8');
      for (const match of sql.matchAll(
        /file_size\s+between\s+1\s+and\s+(\d+)/g,
      )) {
        if (Number(match[1]) !== MAX_UPLOAD_BYTES) {
          offenders.push(`${file}: ${match[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
