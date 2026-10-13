import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/exports/cleanup', () => ({
  cleanupExpiredExports: async () => ({ expired: 0, failed: 0 }),
}));

const { rpc, deleteUser } = vi.hoisted(() => ({
  rpc: vi.fn(),
  deleteUser: vi.fn(),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    rpc,
    auth: { admin: { deleteUser } },
    from: () => ({
      update: () => ({
        eq: () => ({ lt: () => ({ select: async () => ({ data: [] }) }) }),
      }),
    }),
  }),
}));
const { pruneJob } = await import('@/lib/jobs/maintenance-jobs');
const candidate = {
  id: 'expired-member',
  deletion_requested_at: '2026-09-01T00:00:00Z',
};
const run = () =>
  pruneJob.handler({ now: new Date('2026-10-12T12:00:00Z'), note: vi.fn() });

describe('account cleanup claims', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'accounts_due_for_purge'
          ? [candidate]
          : name === 'claim_account_for_purge'
            ? true
            : 0,
      error: null,
    }));
    deleteUser.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('claims the exact request before calling the Auth deletion API', async () => {
    deleteUser.mockImplementation(async () => {
      expect(rpc).toHaveBeenCalledWith('claim_account_for_purge', {
        p_user_id: candidate.id,
        p_requested_at: candidate.deletion_requested_at,
      });
      return { error: null };
    });
    expect((await run()).detail.accountsPurged).toBe(1);
    expect(deleteUser).toHaveBeenCalledWith(candidate.id);
  });

  it.each([false, null])(
    'does not delete when the claim returns %s',
    async (data) => {
      rpc.mockImplementation(async (name: string) => ({
        data: name === 'accounts_due_for_purge' ? [candidate] : data,
        error: null,
      }));
      const result = await run();
      expect(deleteUser).not.toHaveBeenCalled();
      expect(result.detail.accountsPurged).toBe(0);
      expect(result.failed).toBe(0);
    },
  );

  it('fails closed on a claim error and continues to the next account', async () => {
    rpc.mockImplementation(
      async (name: string, args?: { p_user_id: string }) => {
        if (name === 'accounts_due_for_purge')
          return {
            data: [candidate, { ...candidate, id: 'next-member' }],
            error: null,
          };
        if (
          name === 'claim_account_for_purge' &&
          args?.p_user_id === candidate.id
        )
          return { data: null, error: { message: 'claim unavailable' } };
        return { data: true, error: null };
      },
    );
    const result = await run();
    expect(deleteUser.mock.calls).toEqual([['next-member']]);
    expect(result.failed).toBe(1);
    expect(result.detail.accountsPurged).toBe(1);
  });

  it('records a provider refusal without releasing the claim', async () => {
    deleteUser.mockResolvedValue({ error: { message: 'provider refused' } });
    expect((await run()).failed).toBe(1);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      'prune_rate_limit_counters',
      'accounts_due_for_purge',
      'claim_account_for_purge',
    ]);
  });

  it('records a thrown provider failure and continues to the next account', async () => {
    rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'accounts_due_for_purge'
          ? [candidate, { ...candidate, id: 'next-member' }]
          : true,
      error: null,
    }));
    deleteUser.mockRejectedValueOnce(new Error('provider connection lost'));
    const result = await run();
    expect(deleteUser.mock.calls).toEqual([[candidate.id], ['next-member']]);
    expect(result.failed).toBe(1);
    expect(result.detail.accountsPurged).toBe(1);
  });
});
