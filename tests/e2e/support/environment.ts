import { test, type APIRequestContext } from '@playwright/test';

/**
 * Telling "refused" apart from "broken".
 *
 * The end-to-end suites run against a built application, but not every
 * environment that can serve one has a migrated database behind it. Without
 * one, every data endpoint answers 500 — which looks exactly like a refusal if
 * you only check that the status is not 200.
 *
 * That distinction matters more here than anywhere else in the suite. These
 * are the tests that assert the access boundary holds; reading a fault as a
 * refusal would report a green tick for a boundary that was never exercised.
 *
 * So the checks skip instead. A skipped test is visible in the report as
 * not-run, with the reason attached — honest about what was and was not
 * verified, and it does not leave a build permanently red in an environment
 * that was never going to have Postgres in it.
 */

export function skipIfEnvironmentIsDown(status: number, path: string): void {
  test.skip(
    status === 500,
    `${path} returned 500: the app cannot reach its database, so this check ` +
      `cannot tell a refusal from a fault. Run it against an environment with ` +
      `migrations applied.`,
  );
}

/** Whether the database is reachable at all, for tests that assert on content. */
export async function databaseIsReachable(
  request: APIRequestContext,
): Promise<boolean> {
  const response = await request.get('/api/v1/opportunities', {
    failOnStatusCode: false,
  });
  return response.status() !== 500;
}

export async function skipWithoutDatabase(
  request: APIRequestContext,
): Promise<void> {
  test.skip(
    !(await databaseIsReachable(request)),
    'No reachable database: this check asserts on seeded content. Apply the ' +
      'migrations and load supabase/seed.sql first.',
  );
}
