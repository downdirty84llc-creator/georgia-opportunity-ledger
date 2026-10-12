import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildViewer, canExportCsv } from '@/lib/access/entitlements';

const { signInWithPassword, signOut, maybeSingle, update, eq } = vi.hoisted(
  () => ({
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    maybeSingle: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
  }),
);

vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { signInWithPassword, signOut },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      update: (value: unknown) => {
        update(value);
        return { eq };
      },
    }),
  }),
}));
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://ledger.example' },
}));
vi.mock('@/lib/http/auth-rate-limit', () => ({
  checkAuthRateLimit: async () => ({ allowed: true, resetAt: new Date() }),
}));

const { POST } = await import('@/app/api/v1/auth/login/route');
const pendingDate = '2026-10-01T12:00:00.000Z';

function logIn() {
  return POST(
    new Request('https://ledger.example/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'password',
        email: 'member@example.test',
        password: 'fixture-password',
      }),
    }),
    undefined as never,
  );
}

describe('sign-in during the account deletion grace period', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T12:00:00.000Z'));
    signInWithPassword.mockResolvedValue({
      data: { user: { id: 'member-1' } },
      error: null,
    });
    signOut.mockResolvedValue({ error: null });
    maybeSingle.mockResolvedValue({
      data: { account_status: 'closed', deletion_requested_at: pendingDate },
      error: null,
    });
    eq.mockResolvedValue({ error: null });
  });

  afterEach(() => vi.useRealTimers());

  it('allows sign-in so the member can reach the withdrawal control', async () => {
    const response = await logIn();

    expect(response.status).toBe(200);
    expect((await response.json()).data.deletionPending).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
    // Signing in must not itself cancel deletion or reopen the account.
    expect(update).toHaveBeenCalledWith({ last_login_at: expect.any(String) });
    expect(eq).toHaveBeenCalledWith('id', 'member-1');
  });

  it.each([
    null,
    'invalid',
    '2026-09-12T12:00:00.000Z',
    '2026-09-01T12:00:00.000Z',
  ])(
    'refuses a closed account without a current grace period (%s)',
    async (requestedAt) => {
      maybeSingle.mockResolvedValue({
        data: { account_status: 'closed', deletion_requested_at: requestedAt },
        error: null,
      });

      expect((await logIn()).status).toBe(403);
      expect(signOut).toHaveBeenCalledOnce();
      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each(['active', 'suspended'])(
    'does not mark a %s account as awaiting deletion',
    async (status) => {
      maybeSingle.mockResolvedValue({
        data: { account_status: status, deletion_requested_at: null },
        error: null,
      });

      const response = await logIn();
      expect(response.status).toBe(200);
      expect((await response.json()).data.deletionPending).toBe(false);
      expect(signOut).not.toHaveBeenCalled();
    },
  );

  it('keeps a signed-in closed account ineligible for paid capabilities', async () => {
    expect((await logIn()).status).toBe(200);
    const viewer = buildViewer(
      {
        userId: 'member-1',
        role: 'member',
        accountStatus: 'closed',
        accessRankOverride: null,
        accessRankOverrideExpiresAt: null,
      },
      {
        status: 'active',
        planAccessRank: 30,
        currentPeriodEnd: new Date('2026-11-12T12:00:00.000Z'),
        cancelAtPeriodEnd: false,
      },
      null,
    );
    expect(viewer.isAuthenticated).toBe(true);
    expect(viewer.accessRank).toBe(0);
    expect(canExportCsv(viewer).allowed).toBe(false);
  });
});
