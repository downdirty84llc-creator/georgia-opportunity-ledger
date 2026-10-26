import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createPublicSupabaseClient } = vi.hoisted(() => ({
  createPublicSupabaseClient: vi.fn(),
}));
vi.mock('@/lib/db/public', () => ({ createPublicSupabaseClient }));

import { loadPublicStats } from '@/lib/public-data';

const metrics = ['active', 'counties', 'verified', 'deadlines'] as const;
type Metric = (typeof metrics)[number];
const counts: Record<Metric, number> = {
  active: 12,
  counties: 159,
  verified: 4,
  deadlines: 0,
};
const providerFetch = vi.fn<typeof fetch>();

function metricFor(input: RequestInfo | URL): Metric {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/counties')) return 'counties';
  if (url.searchParams.has('date_verified')) return 'verified';
  if (url.searchParams.has('closing_date')) return 'deadlines';
  return 'active';
}

function respond(failed?: Metric, missingCount = false) {
  providerFetch.mockImplementation(async (input) => {
    const metric = metricFor(input);
    if (metric === failed) {
      return missingCount
        ? new Response(null, { status: 200 })
        : Response.json(
            { message: 'Query refused', code: '42501' },
            { status: 403 },
          );
    }
    return new Response(null, {
      status: 200,
      headers: { 'content-range': `*/${counts[metric]}` },
    });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubEnv('NEXT_PHASE', 'phase-production-build');
  vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'production');
  respond();
  // Real SDK parsing, with all HTTP requests intercepted and no live data.
  createPublicSupabaseClient.mockReturnValue(
    createClient('https://supabase.example.test', 'test-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: providerFetch },
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('public statistics distinguish unavailable counts from zero', () => {
  it('preserves measured counts, including a genuine zero', async () => {
    expect(await loadPublicStats()).toEqual({
      activeOpportunities: 12,
      countiesCovered: 159,
      verifiedThisWeek: 4,
      upcomingDeadlines: 0,
    });
    expect(providerFetch).toHaveBeenCalledTimes(4);
    for (const [, options] of providerFetch.mock.calls) {
      expect(options?.method).toBe('HEAD');
      expect(new Headers(options?.headers).get('prefer')).toContain(
        'count=exact',
      );
    }
  });

  it.each(metrics)(
    'fails production prerender when %s is refused',
    async (metric) => {
      respond(metric);
      await expect(loadPublicStats()).rejects.toThrow();
    },
  );

  it.each(metrics)(
    'fails staging prerender when %s is refused',
    async (metric) => {
      vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'staging');
      respond(metric);
      await expect(loadPublicStats()).rejects.toThrow();
    },
  );

  it.each(metrics)(
    'does not claim zero when %s has no exact count',
    async (metric) => {
      respond(metric, true);
      await expect(loadPublicStats()).rejects.toThrow();
    },
  );

  it.each(metrics)(
    'keeps runtime available without inventing %s',
    async (metric) => {
      vi.stubEnv('NEXT_PHASE', 'phase-production-server');
      respond(metric);
      await expect(loadPublicStats()).resolves.toBeNull();
      expect(console.error).toHaveBeenCalled();
    },
  );

  it('allows an isolated development build without inventing counts', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', 'development');
    vi.useFakeTimers();
    providerFetch.mockRejectedValue(new TypeError('Simulated network failure'));
    const result = loadPublicStats();
    // Let the SDK exhaust its network retries without waiting for wall time.
    await vi.runAllTimersAsync();
    await expect(result).resolves.toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
