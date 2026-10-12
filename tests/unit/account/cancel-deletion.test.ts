import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getViewer, maybeSingle, rpc, checkRateLimit } = vi.hoisted(() => ({
  getViewer: vi.fn(),
  maybeSingle: vi.fn(),
  rpc: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getViewer }));
vi.mock('@/lib/analytics/events', () => ({ track: vi.fn() }));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    rpc,
  }),
}));
vi.mock('@/lib/http/rate-limit', () => ({
  checkRateLimit,
  rateLimitIdentity: () => 'fixture-member',
  rateLimitHeaders: () => ({}),
}));
const { DELETE } = await import('@/app/api/v1/account/deletion/route');
const withdraw = () =>
  DELETE(
    new Request('https://ledger.example/api/v1/account/deletion', {
      method: 'DELETE',
    }),
    undefined as never,
  );
const profile = {
  account_status: 'closed',
  deletion_requested_at: '2026-10-01T12:00:00Z',
};

describe('withdraw a customer deletion request', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00Z'));
    getViewer.mockResolvedValue({
      isAuthenticated: true,
      userId: 'fixture-member',
    });
    checkRateLimit.mockResolvedValue({ allowed: true, resetAt: new Date() });
    maybeSingle.mockResolvedValue({ data: profile, error: null });
    rpc.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.useRealTimers());

  it('allows a current closed request through the session-bound RPC', async () => {
    expect((await withdraw()).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('cancel_account_deletion');
  });
  it.each(['active', 'suspended'])(
    'refuses a %s profile with a leftover timestamp',
    async (account_status) => {
      maybeSingle.mockResolvedValue({
        data: { ...profile, account_status },
        error: null,
      });
      expect((await withdraw()).status).toBe(404);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it.each([null, 'invalid', '2026-09-12T12:00:00Z', '2026-10-13T12:00:00Z'])(
    'refuses a missing, invalid, expired or future request (%s)',
    async (deletion_requested_at) => {
      maybeSingle.mockResolvedValue({
        data: { ...profile, deletion_requested_at },
        error: null,
      });
      expect((await withdraw()).status).toBe(404);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it('reports a database read failure instead of claiming no request exists', async () => {
    maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'fixture failure' },
    });
    expect((await withdraw()).status).toBe(500);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('handles the request expiring or changing before the RPC acquires its lock', async () => {
    rpc.mockResolvedValue({
      error: {
        code: 'P0002',
        message: 'No current deletion request to withdraw',
      },
    });
    expect((await withdraw()).status).toBe(404);
  });
  it('requires authentication', async () => {
    getViewer.mockResolvedValue({ isAuthenticated: false });
    expect((await withdraw()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('honors the account-action rate limit', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, resetAt: new Date() });
    expect((await withdraw()).status).toBe(429);
    expect(rpc).not.toHaveBeenCalled();
  });
});
