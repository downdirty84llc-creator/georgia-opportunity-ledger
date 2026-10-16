import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  factors: vi.fn(),
  assurance: vi.fn(),
  enroll: vi.fn(),
  verify: vi.fn(),
  viewer: vi.fn(),
  rate: vi.fn(),
}));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      mfa: {
        listFactors: m.factors,
        getAuthenticatorAssuranceLevel: m.assurance,
        enroll: m.enroll,
        challengeAndVerify: m.verify,
      },
    },
  }),
}));
vi.mock('@/lib/auth/session', () => ({ getViewer: m.viewer }));
vi.mock('@/lib/http/rate-limit', () => ({
  checkRateLimit: m.rate,
  rateLimitIdentity: () => 'staff:1',
}));
import { getMfaStatus } from '@/lib/auth/mfa';
import { withAdminHandling } from '@/lib/http/admin-handler';
import { ok } from '@/lib/http/responses';
import { POST } from '@/app/api/v1/auth/mfa/route';

const factorId = '17171717-1717-4717-8717-171717171717';
const request = (body: unknown, origin = 'https://ledger.example') =>
  new Request('https://ledger.example/api/v1/auth/mfa', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.viewer.mockResolvedValue({
    isAuthenticated: true,
    isStaff: true,
    role: 'editor',
    accountStatus: 'active',
    userId: 'staff-1',
  });
  m.factors.mockResolvedValue({
    data: { totp: [{ id: factorId, status: 'verified' }] },
    error: null,
  });
  m.assurance.mockResolvedValue({
    data: { currentLevel: 'aal2', nextLevel: 'aal2' },
    error: null,
  });
  m.rate.mockResolvedValue({ allowed: true, resetAt: new Date() });
  m.enroll.mockResolvedValue({
    data: { id: factorId, totp: { qr_code: 'qr', secret: 'fixture' } },
    error: null,
  });
  m.verify.mockResolvedValue({
    data: { access_token: 'must-not-return', refresh_token: 'must-not-return' },
    error: null,
  });
});
describe('staff MFA fails closed', () => {
  it.each(['aal1', null])(
    'requires a challenge for %s even if next level is absent',
    async (currentLevel) => {
      m.assurance.mockResolvedValue({
        data: { currentLevel, nextLevel: null },
        error: null,
      });
      expect((await getMfaStatus(true)).state).toBe('challenge_required');
    },
  );
  it.each(['factors', 'assurance'] as const)(
    'does not grant access when %s fails',
    async (field) => {
      m[field].mockResolvedValue({
        data: null,
        error: { message: 'unavailable' },
      });
      expect((await getMfaStatus(true)).state).toBe('unavailable');
    },
  );
  it('requires enrolment when no verified factor remains', async () => {
    m.factors.mockResolvedValue({ data: { totp: [] }, error: null });
    expect((await getMfaStatus(true)).state).toBe('enrolment_required');
  });
  it('accepts verified aal2 and does not demand MFA of ordinary members', async () => {
    expect((await getMfaStatus(true)).state).toBe('satisfied');
    m.factors.mockClear();
    expect((await getMfaStatus(false)).state).toBe('not_required');
    expect(m.factors).not.toHaveBeenCalled();
  });
  it.each(['aal1', null])(
    'blocks direct admin API calls at %s before any action',
    async (currentLevel) => {
      m.assurance.mockResolvedValue({ data: { currentLevel }, error: null });
      const action = vi.fn(async () => ok({ changed: true }));
      const response = await withAdminHandling(action)(
        request({}),
        undefined as never,
      );
      expect(response.status).toBe(403);
      expect(action).not.toHaveBeenCalled();
    },
  );
  it('runs the role-specific handler only after verified active staff', async () => {
    const action = vi.fn(async () => ok({ changed: true }));
    expect(
      (await withAdminHandling(action)(request({}), undefined as never)).status,
    ).toBe(200);
    expect(action).toHaveBeenCalledOnce();
  });
  it('blocks inactive staff and ordinary members', async () => {
    for (const viewer of [
      { isAuthenticated: true, role: 'editor', accountStatus: 'suspended' },
      { isAuthenticated: true, role: 'member', accountStatus: 'active' },
    ]) {
      m.viewer.mockResolvedValue(viewer);
      const action = vi.fn(async () => ok({}));
      expect(
        (await withAdminHandling(action)(request({}), undefined as never))
          .status,
      ).toBe(403);
      expect(action).not.toHaveBeenCalled();
    }
  });
});
describe('MFA uses the server-owned session', () => {
  it('enrols the session owner and prevents caching the setup secret', async () => {
    const response = await POST(
      request({ action: 'enroll' }),
      undefined as never,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(m.enroll).toHaveBeenCalledWith({
      factorType: 'totp',
      friendlyName: 'Ledger staff',
    });
  });
  it('verifies with the session client without exposing session tokens', async () => {
    const response = await POST(
      request({ action: 'verify', factorId, code: '123456' }),
      undefined as never,
    );
    expect(await response.json()).toEqual({ data: { verified: true } });
    expect(m.verify).toHaveBeenCalledWith({ factorId, code: '123456' });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('refuses cross-site enrolment and body-supplied ownership', async () => {
    expect(
      (
        await POST(
          request({ action: 'enroll' }, 'https://attacker.example'),
          undefined as never,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          request({ action: 'enroll', userId: 'someone-else' }),
          undefined as never,
        )
      ).status,
    ).toBe(422);
    expect(m.enroll).not.toHaveBeenCalled();
  });
  it('refuses malformed, rate-limited and rejected codes', async () => {
    expect(
      (
        await POST(
          request({ action: 'verify', factorId, code: '123' }),
          undefined as never,
        )
      ).status,
    ).toBe(422);
    m.rate.mockResolvedValueOnce({ allowed: false, resetAt: new Date() });
    expect(
      (
        await POST(
          request({ action: 'verify', factorId, code: '123456' }),
          undefined as never,
        )
      ).status,
    ).toBe(429);
    expect(m.verify).not.toHaveBeenCalled();
    m.verify.mockResolvedValueOnce({ error: { message: 'invalid' } });
    expect(
      (
        await POST(
          request({ action: 'verify', factorId, code: '123456' }),
          undefined as never,
        )
      ).status,
    ).toBe(400);
  });
});
