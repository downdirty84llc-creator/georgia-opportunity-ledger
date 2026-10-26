import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportError, client, update, rpc, viewer } = vi.hoisted(() => ({
  reportError: vi.fn(),
  client: vi.fn(),
  update: vi.fn(),
  rpc: vi.fn(),
  viewer: {
    isAuthenticated: true,
    accountStatus: 'active',
    role: 'editor',
    userId: 'editor-1',
  },
}));
vi.mock('@/lib/observability/report-error', () => ({ reportError }));
vi.mock('@/lib/db/server', () => ({ createServerSupabaseClient: client }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: client }));
vi.mock('@/lib/auth/session', () => ({ getViewer: async () => viewer }));
vi.mock('@/lib/auth/mfa', () => ({
  mfaRequiredForRole: () => true,
  getMfaStatus: async () => ({ state: 'satisfied' }),
}));
vi.mock('@/lib/analytics/events', () => ({ track: vi.fn() }));
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://ledger.example' },
}));
vi.mock('@/lib/http/auth-rate-limit', () => ({
  checkAuthRateLimit: async () => ({ allowed: true }),
}));
vi.mock('@/lib/http/rate-limit', () => ({
  checkRateLimit: async () => ({ allowed: true }),
  rateLimitIdentity: () => 'test-only',
}));

const login = await import('@/app/api/v1/auth/login/route');
const registration = await import('@/app/api/v1/auth/register/route');
const recovery = await import('@/app/api/v1/auth/password-reset/route');
const mfa = await import('@/app/api/v1/auth/mfa/route');
const publish = await import('@/app/api/v1/admin/reports/[id]/publish/route');

function request(path: string, method: string, body?: string) {
  return new Request(`https://ledger.example${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://ledger.example',
    },
    body,
  });
}

describe('request JSON boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewer.isAuthenticated = true;
    client.mockImplementation(async () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: 'report-1',
                status: 'draft',
                executive_summary: 'Reviewed summary',
              },
            }),
          }),
        }),
        update: (value: unknown) => {
          update(value);
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({ data: value, error: null }),
              }),
            }),
          };
        },
      }),
      rpc,
    }));
  });

  it.each([
    ['login', 'POST', login.POST],
    ['register', 'POST', registration.POST],
    ['password-reset', 'POST', recovery.POST],
    ['password-reset', 'PUT', recovery.PUT],
    ['mfa', 'POST', mfa.POST],
  ] as const)(
    'rejects malformed %s %s without telemetry or account writes',
    async (path, method, handler) => {
      const response = await handler(
        request(
          `/api/v1/auth/${path}`,
          method,
          'sensitive-test-marker{"password":"synthetic-only"}',
        ),
        undefined as never,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: {
          code: 'bad_request',
          message: 'Request body must contain valid JSON.',
        },
      });
      expect(client).not.toHaveBeenCalled();
      expect(reportError).not.toHaveBeenCalled();
    },
  );

  it('keeps valid JSON with invalid fields as a 422 validation response', async () => {
    const response = await login.POST(
      request('/api/v1/auth/login', 'POST', '{}'),
      undefined as never,
    );
    expect(response.status).toBe(422);
    expect(client).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('does not publish immediately when a scheduled-publish body is malformed', async () => {
    const response = await publish.POST(
      request(
        '/api/v1/admin/reports/report-1/publish',
        'POST',
        '{"scheduledAt":"2099-01-01T00:00:00Z",',
      ),
      { params: Promise.resolve({ id: 'report-1' }) } as never,
    );
    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('preserves the documented no-body publish operation', async () => {
    const response = await publish.POST(
      request('/api/v1/admin/reports/report-1/publish', 'POST'),
      { params: Promise.resolve({ id: 'report-1' }) } as never,
    );
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published', scheduled_at: null }),
    );
  });

  it('preserves a valid future publication time', async () => {
    const scheduledAt = '2099-01-01T00:00:00.000Z';
    const response = await publish.POST(
      request(
        '/api/v1/admin/reports/report-1/publish',
        'POST',
        JSON.stringify({ scheduledAt }),
      ),
      { params: Promise.resolve({ id: 'report-1' }) } as never,
    );
    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'scheduled',
        scheduled_at: scheduledAt,
        published_at: null,
      }),
    );
  });

  it('checks staff access before reading a malformed publication request', async () => {
    viewer.isAuthenticated = false;
    const body = request('/api/v1/admin/reports/report-1/publish', 'POST', '{');
    const response = await publish.POST(body, {
      params: Promise.resolve({ id: 'report-1' }),
    } as never);
    expect(response.status).toBe(403);
    expect(body.bodyUsed).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });
});
