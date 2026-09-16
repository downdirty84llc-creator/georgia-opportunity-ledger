import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { JOBS } from '@/lib/jobs/registry';

/**
 * The deployment schedules match the registry.
 *
 * A job's cadence could be written in four places: the registry, a Netlify
 * scheduled function, the pg_cron schedule, and `vercel.json`. The middle two
 * are generated from the first, and this is what makes that true rather than
 * aspirational — the registry carried a comment promising it from the
 * beginning while `vercel.json` was in fact maintained by hand.
 *
 * `vercel.json` is now the odd one out: it declares no crons at all, because
 * the hobby plan refuses a cadence more frequent than daily. That absence is
 * asserted here too, so restoring it is a deliberate act rather than a
 * regeneration accident.
 *
 * A drifted schedule is a bad failure to debug: the job runs, the code is
 * right, and it simply fires at the wrong time on one platform.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const FUNCTIONS = join(ROOT, 'netlify', 'functions');

interface VercelConfig {
  crons?: Array<{ path: string; schedule: string }>;
}

const vercel = JSON.parse(
  readFileSync(join(ROOT, 'vercel.json'), 'utf8'),
) as VercelConfig;

const pgCron = readFileSync(
  join(ROOT, 'supabase', 'pg_cron-schedule.sql'),
  'utf8',
);

describe('vercel.json', () => {
  it('declares no crons, because the hobby plan rejects this schedule', () => {
    // Hobby enforces a once-per-day minimum cadence and fails the deploy on
    // anything more frequent. Six of these jobs run every 5-30 minutes, so
    // declaring them here makes the project undeployable rather than slow.
    // The schedule lives in supabase/pg_cron-schedule.sql instead.
    expect(vercel.crons ?? []).toEqual([]);
  });
});

describe('the pg_cron schedule', () => {
  it('schedules every job in the registry, and only those', () => {
    const scheduled = [...pgCron.matchAll(/schedule_ledger_job\(\s*'([^']+)'/g)]
      .map((match) => match[1])
      .sort();
    expect(scheduled).toEqual(JOBS.map((job) => job.definition.name).sort());
  });

  it('uses the registry cadence for each', () => {
    for (const job of JOBS) {
      const pattern = new RegExp(
        `schedule_ledger_job\\(\\s*'${job.definition.name}',\\s*'([^']+)'`,
      );
      const match = pgCron.match(pattern);
      expect(match?.[1], job.definition.name).toBe(job.schedule);
    }
  });

  it('carries no secret', () => {
    // The token and the site URL come from Vault at call time. A generated file
    // is exactly the kind of thing that gets committed without a second look.
    expect(pgCron).not.toMatch(/Bearer\s+\S/);
    expect(pgCron).not.toMatch(/sk_live_|whsec_|eyJ[A-Za-z0-9_-]{10,}/);
  });
});

describe('the Netlify scheduled functions', () => {
  const files = readdirSync(FUNCTIONS).filter((name) => name.endsWith('.ts'));

  it('has exactly one per job', () => {
    expect(files.sort()).toEqual(
      JOBS.map((job) => `${job.definition.name}.ts`).sort(),
    );
  });

  it('declares the registry cadence', () => {
    for (const job of JOBS) {
      const source = readFileSync(
        join(FUNCTIONS, `${job.definition.name}.ts`),
        'utf8',
      );
      expect(source, job.definition.name).toContain(
        `export const config = { schedule: '${job.schedule}' };`,
      );
    }
  });

  it('calls its own job and no other', () => {
    // A copy-paste that leaves the previous job's path behind would schedule
    // one job twice and another never, which nothing else would catch.
    for (const job of JOBS) {
      const name = job.definition.name;
      const source = readFileSync(join(FUNCTIONS, `${name}.ts`), 'utf8');

      expect(source, name).toContain(`/api/v1/jobs/${name}\``);

      const otherPaths = JOBS.map((other) => other.definition.name)
        .filter((other) => other !== name)
        .filter((other) => source.includes(`/api/v1/jobs/${other}\``));
      expect(otherPaths, `${name} also calls`).toEqual([]);
    }
  });

  it('sends the shared secret, since Netlify will not', () => {
    // Vercel Cron attaches CRON_SECRET itself; Netlify has no equivalent, so
    // a function that forgot the header would get a 401 on every run.
    for (const job of JOBS) {
      const source = readFileSync(
        join(FUNCTIONS, `${job.definition.name}.ts`),
        'utf8',
      );
      expect(source, job.definition.name).toContain('Bearer ${secret}');
      expect(source, job.definition.name).toContain('CRON_SECRET');
    }
  });

  it('refuses to run unconfigured rather than failing quietly', () => {
    for (const job of JOBS) {
      const source = readFileSync(
        join(FUNCTIONS, `${job.definition.name}.ts`),
        'utf8',
      );
      expect(source, job.definition.name).toContain('status: 500');
    }
  });
});

describe('the registry itself', () => {
  it('gives every job a unique name', () => {
    const names = JOBS.map((job) => job.definition.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every job a five-field cron expression', () => {
    for (const job of JOBS) {
      const fields = job.schedule.trim().split(/\s+/);
      expect(fields, `${job.definition.name}: "${job.schedule}"`).toHaveLength(
        5,
      );
    }
  });
});
