import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUser, updateUser, resetPasswordForEmail, checkRateLimit } =
  vi.hoisted(() => ({
    getUser: vi.fn(),
    updateUser: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    checkRateLimit: vi.fn(),
  }));

vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser, updateUser, resetPasswordForEmail },
  }),
}));
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://ledger.example' },
}));
vi.mock('@/lib/http/rate-limit', () => ({
  checkRateLimit,
  rateLimitIdentity: (_request: Request, id: string | null) => id ?? 'ip:test',
}));

const route = await import('@/app/api/v1/auth/password-reset/route');
const site = 'https://ledger.example';

function request(method: string, body: unknown, origin = site) {
  return new Request(`${site}/api/v1/auth/password-reset`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

describe('password recovery with a server-owned session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({
      data: { user: { id: 'member-1' } },
      error: null,
    });
    updateUser.mockResolvedValue({
      data: { user: { id: 'member-1' } },
      error: null,
    });
    resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    checkRateLimit.mockResolvedValue({ allowed: true, resetAt: new Date() });
  });

  it('sends recovery links through the server code-exchange callback', async () => {
    await route.POST(
      request('POST', { email: 'member@example.test' }),
      undefined as never,
    );
    expect(resetPasswordForEmail).toHaveBeenCalledWith('member@example.test', {
      redirectTo: `${site}/auth/callback?next=%2Fauth%2Freset-password`,
    });
  });

  it('keeps reset requests indistinguishable for unknown addresses', async () => {
    const first = await route.POST(
      request('POST', { email: 'member@example.test' }),
      undefined as never,
    );
    const second = await route.POST(
      request('POST', { email: 'unknown@example.test' }),
      undefined as never,
    );
    expect(await first.json()).toEqual(await second.json());
  });

  it('updates only the user authenticated by the session client', async () => {
    const response = await route.PUT(
      request('PUT', {
        password: 'a-new-long-password',
        userId: 'other-member',
      }),
      undefined as never,
    );
    expect(response.status).toBe(200);
    expect(getUser).toHaveBeenCalledOnce();
    expect(updateUser).toHaveBeenCalledWith({
      password: 'a-new-long-password',
    });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('refuses an absent or invalid session without changing a password', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'expired' },
    });
    const response = await route.PUT(
      request('PUT', { password: 'a-new-long-password' }),
      undefined as never,
    );
    expect(response.status).toBe(401);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('refuses a cross-origin password change', async () => {
    const response = await route.PUT(
      request(
        'PUT',
        { password: 'a-new-long-password' },
        'https://untrusted.example',
      ),
      undefined as never,
    );
    expect(response.status).toBe(403);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each(['short', 'x'.repeat(201)])(
    'refuses an invalid password length',
    async (password) => {
      const response = await route.PUT(
        request('PUT', { password }),
        undefined as never,
      );
      expect(response.status).toBe(422);
      expect(updateUser).not.toHaveBeenCalled();
    },
  );

  it('enforces the per-account password-change rate limit', async () => {
    checkRateLimit.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 60_000),
    });
    const response = await route.PUT(
      request('PUT', { password: 'a-new-long-password' }),
      undefined as never,
    );
    expect(response.status).toBe(429);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('does not report success or expose provider details when the update fails', async () => {
    updateUser.mockResolvedValue({
      error: { message: 'internal provider detail' },
    });
    const response = await route.PUT(
      request('PUT', { password: 'a-new-long-password' }),
      undefined as never,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('internal provider detail');
  });
});
