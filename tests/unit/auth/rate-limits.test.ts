import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RATE_LIMITS } from '@/lib/http/rate-limit';

const { rpc, signInWithPassword, signInWithOtp, resetPasswordForEmail } =
  vi.hoisted(() => ({
    rpc: vi.fn(),
    signInWithPassword: vi.fn(),
    signInWithOtp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
  }));

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({ rpc }),
}));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { signInWithPassword, signInWithOtp, resetPasswordForEmail },
  }),
}));
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://ledger.example' },
}));

const login = await import('@/app/api/v1/auth/login/route');
const recovery = await import('@/app/api/v1/auth/password-reset/route');
const counters = new Map<string, number>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z'));
  counters.clear();
  // Keep the actual route, identity selection and limiter adapter. Replace
  // only the database's counter RPC and the authentication provider.
  rpc.mockImplementation(
    (
      name: string,
      input: { p_key: string; p_limit: number; p_window_seconds: number },
    ) => {
      expect(name).toBe('check_rate_limit');
      const window = Math.floor(Date.now() / (input.p_window_seconds * 1000));
      const key = `${window}:${input.p_key}`;
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return {
        single: async () => ({
          data: {
            allowed: count <= input.p_limit,
            remaining: Math.max(0, input.p_limit - count),
            reset_at: new Date(
              (window + 1) * input.p_window_seconds * 1000,
            ).toISOString(),
          },
          error: null,
        }),
      };
    },
  );
  signInWithPassword.mockResolvedValue({
    data: { user: null },
    error: { message: 'Invalid credentials' },
  });
  signInWithOtp.mockResolvedValue({ data: {}, error: null });
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => vi.useRealTimers());

const flows = [
  {
    name: 'password sign-in',
    method: 'password',
    action: 'login',
    handler: login.POST,
    provider: signInWithPassword,
    unthrottledStatus: 401,
  },
  {
    name: 'magic-link sign-in',
    method: 'magic_link',
    action: 'login',
    handler: login.POST,
    provider: signInWithOtp,
    unthrottledStatus: 200,
  },
  {
    name: 'password-reset requests',
    method: 'reset',
    action: 'passwordReset',
    handler: recovery.POST,
    provider: resetPasswordForEmail,
    unthrottledStatus: 200,
  },
] as const;

for (const flow of flows) {
  const limit = RATE_LIMITS[flow.action].limit;
  const submit = (ip: string, email: string) =>
    flow.handler(
      new Request(
        `https://ledger.example/api/v1/auth/${flow.method === 'reset' ? 'password-reset' : 'login'}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-real-ip': ip },
          body: JSON.stringify({
            method: flow.method,
            email,
            password: 'wrong-password',
          }),
        },
      ),
      undefined as never,
    );

  describe(flow.name, () => {
    it('keeps one IP limited when the email address changes', async () => {
      for (let i = 0; i < limit; i++) {
        const response = await submit('192.0.2.1', `member${i}@example.test`);
        expect(response.status).toBe(flow.unthrottledStatus);
      }

      const refused = await submit('192.0.2.1', 'another@example.test');

      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(flow.provider).toHaveBeenCalledTimes(limit);
    });

    it('keeps one email limited when the IP or email casing changes', async () => {
      for (let i = 0; i < limit; i++) {
        const response = await submit(
          `192.0.2.${i + 1}`,
          'member@example.test',
        );
        expect(response.status).toBe(flow.unthrottledStatus);
      }

      const refused = await submit('192.0.2.250', 'MEMBER@EXAMPLE.TEST');

      expect(refused.status).toBe(429);
      expect(flow.provider).toHaveBeenCalledTimes(limit);
    });

    it('does not charge an email allowance after the IP is already limited', async () => {
      for (let i = 0; i < limit; i++) {
        await submit('192.0.2.1', `other${i}@example.test`);
      }
      const refused = await submit('192.0.2.1', 'target@example.test');
      expect(refused.status).toBe(429);

      for (let i = 0; i < limit; i++) {
        const response = await submit(
          `198.51.100.${i + 1}`,
          'target@example.test',
        );
        expect(response.status).toBe(flow.unthrottledStatus);
      }
      expect(
        (await submit('198.51.100.250', 'target@example.test')).status,
      ).toBe(429);
    });
  });
}
