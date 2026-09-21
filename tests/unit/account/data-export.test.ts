import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The subject-access export refuses to return a partial file.
 *
 * Every read was previously taken as `?? null` or `?? []`, so a failed query
 * became an empty section in a document that still told the member it held
 * "everything held about this account". An export that is silently incomplete
 * while presenting itself as complete is the worse failure — an error is
 * recoverable, a quiet omission is not, and nobody checks a file for what is
 * missing from it.
 *
 * These tests exist because a guard nobody has watched fail is not a guard.
 */

const TABLES = [
  'profiles',
  'user_preferences',
  'saved_opportunities',
  'saved_searches',
  'alert_preferences',
  'notifications',
  'support_tickets',
  'correction_requests',
] as const;

/** Per-table result, overridden per test. */
let results: Record<
  string,
  { data: unknown; error: { message: string } | null }
>;

function resetResults(): void {
  results = Object.fromEntries(
    TABLES.map((table) => [table, { data: [], error: null }]),
  );
}
resetResults();

/**
 * A query builder that is chainable at every step and awaitable at any of
 * them, which is what the route does: some reads end in `.maybeSingle()`,
 * others are awaited straight after `.eq()`.
 */
function builder(result: { data: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (value: unknown) => unknown, reject?: () => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return chain;
}

vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({
      from: (table: string) =>
        builder(results[table] ?? { data: [], error: null }),
    }),
}));

vi.mock('@/lib/auth/session', () => ({
  getSessionContext: () =>
    Promise.resolve({
      viewer: { isAuthenticated: true, userId: 'member-1' },
      planCode: 'weekly',
      planName: 'Weekly',
      subscriptionStatus: 'active',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    }),
}));

vi.mock('@/lib/http/rate-limit', () => ({
  checkRateLimit: () =>
    Promise.resolve({
      allowed: true,
      remaining: 2,
      limit: 3,
      resetAt: new Date(),
    }),
  rateLimitHeaders: () => ({}),
  rateLimitIdentity: () => 'member-1',
}));

const { GET } = await import('@/app/api/v1/account/data-export/route');

function call(): Promise<Response> {
  // withErrorHandling widens the handler to (request, context: never); the
  // route ignores the second argument, and Next.js passes nothing for a route
  // with no dynamic segment.
  return GET(
    new Request('https://example.test/api/v1/account/data-export'),
    undefined as never,
  ) as unknown as Promise<Response>;
}

describe('the data export', () => {
  beforeEach(() => {
    resetResults();
    vi.clearAllMocks();
  });

  it('returns the file when every read succeeds', async () => {
    const response = await call();
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('exportedAt');
    expect(body).toHaveProperty('savedOpportunities');
  });

  it.each(TABLES)('refuses the whole export when %s fails', async (table) => {
    results[table] = { data: null, error: { message: 'permission denied' } };

    const response = await call();

    // Not 200-with-a-gap. The member is told, and can retry.
    expect(response.status).toBe(500);

    const body = (await response.json()) as { error?: { message?: string } };
    expect(JSON.stringify(body)).not.toContain('exportedAt');
    expect(body.error?.message ?? '').toMatch(/could not be assembled/i);
  });

  it('names every failing section rather than only the first', async () => {
    results['saved_searches'] = {
      data: null,
      error: { message: 'permission denied' },
    };
    results['support_tickets'] = {
      data: null,
      error: { message: 'timeout' },
    };

    const response = await call();
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).toContain('savedSearches');
    expect(body).toContain('supportTickets');
  });

  it('never leaks the underlying database message to the member', async () => {
    // The section name is useful to the member; the driver's message is ours,
    // and belongs in the log rather than the response.
    results['profiles'] = {
      data: null,
      error: { message: 'relation "profiles" does not exist' },
    };

    const body = JSON.stringify(await (await call()).json());
    expect(body).not.toContain('relation "profiles" does not exist');
  });
});
