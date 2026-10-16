import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ status: vi.fn(), role: 'editor' }));
vi.mock('@/lib/auth/mfa', () => ({
  getMfaStatus: m.status,
  mfaRequiredForRole: (role: string) => role === 'editor',
}));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'staff-1' } }, error: null }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === 'profiles'
                ? {
                    role: m.role,
                    account_status: 'active',
                    access_rank_override: 100,
                  }
                : null,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
import { getSessionContext } from '@/lib/auth/session';
beforeEach(() => {
  vi.clearAllMocks();
  m.role = 'editor';
  m.status.mockResolvedValue({ state: 'satisfied' });
});
describe('session staff capabilities', () => {
  it.each(['enrolment_required', 'challenge_required', 'unavailable'])(
    'keeps member access but no staff preview on %s',
    async (state) => {
      m.status.mockResolvedValue({ state });
      const { viewer } = await getSessionContext();
      expect(viewer).toMatchObject({
        isAuthenticated: true,
        role: 'editor',
        isStaff: false,
        accessRank: 0,
      });
      expect(viewer.features.csvExport).toBe(false);
    },
  );
  it('restores staff authority only after verified MFA', async () => {
    expect((await getSessionContext()).viewer).toMatchObject({
      role: 'editor',
      isStaff: true,
      accessRank: 100,
    });
  });
});
