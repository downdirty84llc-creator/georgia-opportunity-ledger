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

describe('Sentry destination configuration', () => {
  beforeEach(() => {
    fetchMock
      .mockReset()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    'ftp://public@errors.example.invalid/123',
    'https://public@errors.example.invalid/project',
    'https://public@errors.example.invalid/123?unexpected=value',
    'https://public@errors.example.invalid/123#unexpected',
    'https://public@errors.example.invalid/123\n',
  ])(
    'refuses a malformed destination without sending or exposing it: %s',
    async (dsn) => {
      vi.stubEnv('SENTRY_DSN', dsn);
      await expect(
        reportError(new Error('Synthetic error')),
      ).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        '[error] SENTRY_DSN is set but could not be parsed',
      );
      expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
        dsn,
      );
    },
  );

  it('routes a prefixed Sentry installation to the project envelope endpoint', async () => {
    vi.stubEnv(
      'SENTRY_DSN',
      'https://public@errors.example.invalid/monitoring/123',
    );
    await reportError(new Error('Synthetic error'));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://errors.example.invalid/monitoring/api/123/envelope/',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not transmit a deprecated DSN password in the envelope', async () => {
    vi.stubEnv(
      'SENTRY_DSN',
      'https://public:legacy-secret@errors.example.invalid/123',
    );
    await reportError(new Error('Synthetic error'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![1];
    expect(JSON.parse(request.body.split('\n')[0]).dsn).toBe(
      'https://public@errors.example.invalid/123',
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('legacy-secret');
  });
});

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
