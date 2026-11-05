import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  viewer: vi.fn(),
  user: vi.fn(),
  report: vi.fn(),
  rate: vi.fn(),
  send: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getViewer: m.viewer }));
vi.mock('@/lib/auth/mfa', () => ({
  mfaRequiredForRole: () => true,
  getMfaStatus: async () => ({ state: 'satisfied' }),
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: m.send }));
vi.mock('@/lib/http/rate-limit', () => ({
  checkRateLimit: m.rate,
  rateLimitIdentity: () => 'admin',
}));
vi.mock('@/lib/observability/report-error', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: m.user },
    rpc: m.audit,
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: m.report }) }) }),
  }),
}));
const { GET, POST } = await import('@/app/api/v1/admin/email-test/route');
const reportId = 'd7fb528d-04e1-45ff-b06d-d57715a40b5d';
const request = (body: object = { reportId }) =>
  new Request('https://ledger.example/api/v1/admin/email-test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://ledger.example',
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv(
    'EMAIL_UNSUBSCRIBE_SECRET',
    'test-only-independent-secret-32-characters',
  );
  vi.stubEnv('CRON_SECRET', 'different-cron-secret');
  m.viewer.mockResolvedValue({
    role: 'super_administrator',
    isAuthenticated: true,
    accountStatus: 'active',
    userId: 'admin',
  });
  m.user.mockResolvedValue({
    data: {
      user: {
        id: 'admin',
        email: 'admin@example.test',
        email_confirmed_at: '2026-11-01T00:00:00Z',
      },
    },
    error: null,
  });
  m.report.mockResolvedValue({
    data: {
      id: reportId,
      slug: 'briefing',
      status: 'published',
      reporting_period_start: '2026-10-29',
      reporting_period_end: '2026-11-04',
    },
    error: null,
  });
  m.rate.mockResolvedValue({ allowed: true, resetAt: new Date() });
  m.send.mockResolvedValue({ ok: true, providerMessageId: 'provider-id' });
  m.audit.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe('administrator email diagnostic', () => {
  it('sends only to the authenticated confirmed inbox, then audits', async () => {
    const response = await POST(request(), undefined as never);
    expect(response.status).toBe(200);
    expect(m.send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        to: 'admin@example.test',
        idempotencyKey: `ledger-report-test-${reportId}-admin`,
        unsubscribeToken: expect.any(String),
      }),
    );
    expect(m.audit).toHaveBeenCalledOnce();
  });
  it('rejects an arbitrary recipient supplied by the caller', async () => {
    expect(
      (
        await POST(
          request({ reportId, to: 'outsider@example.test' }),
          undefined as never,
        )
      ).status,
    ).toBe(422);
    expect(m.send).not.toHaveBeenCalled();
  });
  it('refuses non-super-administrators', async () => {
    m.viewer.mockResolvedValue({
      role: 'editor',
      isAuthenticated: true,
      accountStatus: 'active',
    });
    expect((await POST(request(), undefined as never)).status).toBe(403);
    expect(m.send).not.toHaveBeenCalled();
  });
  it('requires an independent unsubscribe secret and never returns it', async () => {
    vi.stubEnv('CRON_SECRET', process.env.EMAIL_UNSUBSCRIBE_SECRET!);
    expect((await POST(request(), undefined as never)).status).toBe(409);
    const response = await GET(
      new Request('https://ledger.example/api/v1/admin/email-test'),
      undefined as never,
    );
    expect(await response.json()).toEqual({
      data: { dedicatedUnsubscribeSecret: false },
    });
    expect(m.send).not.toHaveBeenCalled();
  });
  it('rejects an unconfirmed inbox', async () => {
    m.user.mockResolvedValue({
      data: { user: { id: 'admin', email: 'admin@example.test' } },
      error: null,
    });
    expect((await POST(request(), undefined as never)).status).toBe(403);
    expect(m.send).not.toHaveBeenCalled();
  });
  it('refuses over-limit sends and unpublished reports', async () => {
    m.rate.mockResolvedValueOnce({ allowed: false, resetAt: new Date() });
    expect((await POST(request(), undefined as never)).status).toBe(429);
    m.report.mockResolvedValueOnce({ data: { status: 'draft' }, error: null });
    expect((await POST(request(), undefined as never)).status).toBe(404);
    expect(m.send).not.toHaveBeenCalled();
  });
  it('does not record provider rejection as successful delivery', async () => {
    m.send.mockResolvedValue({ ok: false, providerMessageId: null });
    expect((await POST(request(), undefined as never)).status).toBe(502);
    expect(m.audit).not.toHaveBeenCalled();
  });
});
