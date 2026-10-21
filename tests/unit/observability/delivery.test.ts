import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({
  publicEnv: {
    environment: 'staging',
    posthogKey: 'test-only',
    posthogHost: 'https://analytics.example.invalid',
  },
}));

const { reportError } = await import('@/lib/observability/report-error');
const { captureToPostHog } = await import('@/lib/analytics/posthog');

const fetchMock = vi.fn();

describe.each([
  {
    service: 'Sentry',
    send: () => reportError(new Error('Synthetic test failure')),
    warning: '[error] could not forward to Sentry',
  },
  {
    service: 'PostHog',
    send: () => captureToPostHog('search_performed', 'test-user', {}),
    warning: '[analytics] PostHog capture failed',
  },
])('$service delivery', ({ service, send, warning }) => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('SENTRY_DSN', 'https://test@errors.example.invalid/123');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('accepts a successful delivery without a failure warning', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(send()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([400, 403, 429, 500])(
    'reports HTTP %i without failing the customer request or logging the response body',
    async (status) => {
      fetchMock.mockResolvedValue(
        new Response('sensitive upstream response', { status }),
      );
      await expect(send()).resolves.toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith(
        warning,
        expect.objectContaining({
          message: `${service} rejected delivery (HTTP ${status})`,
        }),
      );
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
        'sensitive upstream response',
      );
    },
  );

  it('contains network failures so reporting cannot break the customer request', async () => {
    fetchMock.mockRejectedValue(new Error('connection lost'));
    await expect(send()).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(
      warning,
      expect.objectContaining({ message: 'connection lost' }),
    );
  });
});
