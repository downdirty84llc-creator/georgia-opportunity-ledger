import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ viewer: vi.fn(), mfa: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getViewer: m.viewer }));
vi.mock('@/lib/auth/mfa', () => ({
  getMfaStatus: m.mfa,
  mfaRequiredForRole: (role: string) =>
    ['editor', 'billing_manager', 'super_administrator'].includes(role),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({ rpc: m.rpc }),
}));
vi.mock('@/lib/observability/report-error', () => ({ reportError: vi.fn() }));
import { POST } from '@/app/api/v1/admin/billing-review/route';
const valid = {
  eventId: '11111111-2222-4333-8444-555555555555',
  outcome: 'no_change',
  note: 'Partial refund checked; access remains.',
};
const request = (body = valid, origin = 'https://ledger.example') =>
  new Request('https://ledger.example/api/v1/admin/billing-review', {
    method: 'POST',
    headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.viewer.mockResolvedValue({
    isAuthenticated: true,
    accountStatus: 'active',
    role: 'billing_manager',
    userId: 'trusted-actor',
  });
  m.mfa.mockResolvedValue({ state: 'satisfied' });
  m.rpc.mockResolvedValue({ data: 'reviewed', error: null });
});
describe('billing review API', () => {
  it('records a review using only the authenticated actor', async () => {
    expect((await POST(request(), undefined as never)).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith('review_billing_event', {
      p_actor_id: 'trusted-actor',
      p_event_id: valid.eventId,
      p_outcome: valid.outcome,
      p_note: valid.note,
    });
  });
  it.each(['member', 'editor'])('rejects the %s role', async (role) => {
    m.viewer.mockResolvedValue({
      isAuthenticated: true,
      accountStatus: 'active',
      role,
    });
    expect((await POST(request(), undefined as never)).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each(['required', 'unavailable'])(
    'rejects MFA state %s',
    async (state) => {
      m.mfa.mockResolvedValue({ state });
      expect((await POST(request(), undefined as never)).status).toBe(403);
      expect(m.rpc).not.toHaveBeenCalled();
    },
  );
  it('rejects cross-origin changes and forged actor fields', async () => {
    expect(
      (
        await POST(
          request(valid, 'https://attacker.example'),
          undefined as never,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          request({ ...valid, actorId: 'forged' } as typeof valid),
          undefined as never,
        )
      ).status,
    ).toBe(422);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it('requires an explanatory note', async () => {
    expect(
      (
        await POST(
          request({ ...valid, note: '     short' }),
          undefined as never,
        )
      ).status,
    ).toBe(422);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['not_found', 404],
    ['processing', 409],
    ['already_reviewed', 409],
  ])('handles %s without claiming a saved review', async (data, status) => {
    m.rpc.mockResolvedValue({ data, error: null });
    expect((await POST(request(), undefined as never)).status).toBe(status);
  });
  it('rejects a staff role revoked during the request', async () => {
    m.rpc.mockResolvedValue({ error: { code: '42501' } });
    expect((await POST(request(), undefined as never)).status).toBe(403);
  });
  it('does not report a database failure as success', async () => {
    m.rpc.mockResolvedValue({ error: { message: 'audit insert failed' } });
    expect((await POST(request(), undefined as never)).status).toBe(500);
  });
});
