import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ viewer: vi.fn(), mfa: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getViewer: m.viewer }));
vi.mock('@/lib/auth/mfa', () => ({
  getMfaStatus: m.mfa,
  mfaRequiredForRole: (role: string) => role !== 'member',
}));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({ rpc: m.rpc }),
}));
vi.mock('@/lib/observability/report-error', () => ({ reportError: vi.fn() }));
import { POST } from '@/app/api/v1/admin/member-requests/route';
const valid = {
  kind: 'corrections',
  id: '11111111-2222-4333-8444-555555555555',
  expectedUpdatedAt: '2026-11-09T16:00:00.123456+00:00',
  status: 'accepted',
  note: 'Confirmed against the original source.',
};
const request = (body: object = valid, origin = 'https://ledger.example') =>
  new Request('https://ledger.example/api/v1/admin/member-requests', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.viewer.mockResolvedValue({
    isAuthenticated: true,
    accountStatus: 'active',
    role: 'editor',
  });
  m.mfa.mockResolvedValue({ state: 'satisfied' });
  m.rpc.mockResolvedValue({ error: null });
});
describe('member request review API', () => {
  it('preserves database timestamp precision and lets the JWT identify the actor', async () => {
    expect((await POST(request(), undefined as never)).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('review_member_request', {
      p_kind: 'corrections',
      p_id: valid.id,
      p_expected_updated_at: valid.expectedUpdatedAt,
      p_status: 'accepted',
      p_note: valid.note,
    });
  });
  it.each(['member', 'support_representative', 'billing_manager'])(
    'rejects %s from editorial reviews',
    async (role) => {
      m.viewer.mockResolvedValue({
        isAuthenticated: true,
        accountStatus: 'active',
        role,
      });
      expect((await POST(request(), undefined as never)).status).toBe(403);
      expect(m.rpc).not.toHaveBeenCalled();
    },
  );
  it('allows support staff on support only', async () => {
    m.viewer.mockResolvedValue({
      isAuthenticated: true,
      accountStatus: 'active',
      role: 'support_representative',
    });
    expect(
      (
        await POST(
          request({ ...valid, kind: 'support', status: 'resolved' }),
          undefined as never,
        )
      ).status,
    ).toBe(200);
  });
  it.each(['required', 'unavailable'])('refuses MFA %s', async (state) => {
    m.mfa.mockResolvedValue({ state });
    expect((await POST(request(), undefined as never)).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('refuses suspended staff', async () => {
    m.viewer.mockResolvedValue({
      isAuthenticated: true,
      accountStatus: 'suspended',
      role: 'editor',
    });
    expect((await POST(request(), undefined as never)).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('refuses forged actors and cross-origin writes', async () => {
    expect(
      (await POST(request({ ...valid, actorId: 'forged' }), undefined as never))
        .status,
    ).toBe(422);
    expect(
      (
        await POST(
          request(valid, 'https://attacker.example'),
          undefined as never,
        )
      ).status,
    ).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('requires a meaningful note and a kind-specific status', async () => {
    expect(
      (await POST(request({ ...valid, note: '   short' }), undefined as never))
        .status,
    ).toBe(422);
    expect(
      (await POST(request({ ...valid, status: 'closed' }), undefined as never))
        .status,
    ).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['P0002', 404],
    ['40001', 409],
    ['42501', 403],
    ['22023', 400],
    ['XX000', 500],
  ])('reports database refusal %s honestly', async (code, status) => {
    m.rpc.mockResolvedValue({ error: { code, message: 'fixture failure' } });
    expect((await POST(request(), undefined as never)).status).toBe(status);
  });
});
