import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The analytics consent gate.
 *
 * The Privacy and Cookie policies both tell members they can switch product
 * analytics off. These tests are the enforcement of that sentence: an
 * opted-out member must reach neither the first-party table nor the vendor,
 * and a consent lookup that fails must not be read as consent.
 */

const insert = vi.fn().mockResolvedValue({ error: null });
const maybeSingle = vi.fn();
const captureToPostHog = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'analytics_events') return { insert };
      return {
        select: () => ({ eq: () => ({ maybeSingle }) }),
      };
    },
  }),
}));

vi.mock('@/lib/analytics/posthog', () => ({
  captureToPostHog: (...args: unknown[]) => captureToPostHog(...args),
}));

const { track, clearAnalyticsConsentCache, scrubProperties } = await import(
  '@/lib/analytics/events'
);

function consent(analytics_enabled: boolean | null, error: unknown = null) {
  maybeSingle.mockResolvedValue({
    data: analytics_enabled === null ? null : { analytics_enabled },
    error,
  });
}

describe('analytics consent', () => {
  beforeEach(() => {
    insert.mockClear();
    captureToPostHog.mockClear();
    maybeSingle.mockReset();
    clearAnalyticsConsentCache();
  });

  it('records an event for a member who has not opted out', async () => {
    consent(true);
    await track('opportunity_viewed', { userId: 'user-1' });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(captureToPostHog).toHaveBeenCalledTimes(1);
  });

  it('records nothing at all for a member who has opted out', async () => {
    consent(false);
    await track('opportunity_viewed', { userId: 'user-1' });

    expect(insert).not.toHaveBeenCalled();
    // The vendor is the leak that matters most: it is outside our control and
    // outside our retention policy.
    expect(captureToPostHog).not.toHaveBeenCalled();
  });

  it('treats a missing preferences row as consent, matching the column default', async () => {
    consent(null);
    await track('search_performed', { userId: 'user-1' });

    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('fails closed when consent cannot be read', async () => {
    consent(null, { message: 'connection reset' });
    await track('search_performed', { userId: 'user-1' });

    // Unlike the rate limiter, which fails open, an unverifiable consent state
    // must not be read as permission.
    expect(insert).not.toHaveBeenCalled();
    expect(captureToPostHog).not.toHaveBeenCalled();
  });

  it('does not consult consent for an anonymous event', async () => {
    await track('search_performed', { anonymousId: 'anon-1' });

    expect(maybeSingle).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('caches the decision rather than reading it once per event', async () => {
    consent(true);
    await track('opportunity_viewed', { userId: 'user-1' });
    await track('opportunity_viewed', { userId: 'user-1' });
    await track('search_performed', { userId: 'user-1' });

    expect(maybeSingle).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it('keeps the cache per member, so one opt-out does not silence another', async () => {
    maybeSingle
      .mockResolvedValueOnce({ data: { analytics_enabled: false }, error: null })
      .mockResolvedValueOnce({ data: { analytics_enabled: true }, error: null });

    await track('opportunity_viewed', { userId: 'opted-out' });
    await track('opportunity_viewed', { userId: 'opted-in' });

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0]?.[0]).toMatchObject({ user_id: 'opted-in' });
  });

  it('still scrubs forbidden properties for a consenting member', async () => {
    consent(true);
    await track('account_created', {
      userId: 'user-1',
      properties: { email: 'someone@example.com', plan: 'weekly' },
    });

    expect(insert.mock.calls[0]?.[0]).toMatchObject({
      properties: { plan: 'weekly' },
    });
    expect(scrubProperties({ email: 'x@y.z' })).toEqual({});
  });
});
