import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mintUnsubscribeToken } from '@/lib/email/unsubscribe';
const { rows, from, upsert, lookup, rpc } = vi.hoisted(() => ({
  rows: new Map<string, { user_id: string; scope: string }>(),
  from: vi.fn(),
  upsert: vi.fn(),
  lookup: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({ from, rpc }) }));
const {
  resolveUnsubscribeToken,
  rememberUnsubscribeToken,
  unsubscribeTokenHash,
} = await import('@/lib/email/unsubscribe-registry');
const { enqueueEmail } = await import('@/lib/email/outbox');
const USER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'old-test-signing-key');
  rows.clear();
  from.mockReset();
  upsert.mockReset();
  lookup.mockReset();
  rpc.mockReset();
  upsert.mockImplementation(async (row) => {
    if (!rows.has(row.token_hash)) rows.set(row.token_hash, row);
    return { error: null };
  });
  lookup.mockImplementation(async (hash) => ({
    data: rows.get(hash) ?? null,
    error: null,
  }));
  from.mockImplementation(() => ({
    upsert,
    select: () => ({
      eq: (_: string, hash: string) => ({ maybeSingle: () => lookup(hash) }),
    }),
  }));
});
afterEach(() => vi.unstubAllEnvs());

describe('durable unsubscribe verification', () => {
  it.each(['alerts', 'marketing', 'all'] as const)(
    'preserves %s across a key change without storing the key or token',
    async (scope) => {
      const old = mintUnsubscribeToken(USER, scope);
      await rememberUnsubscribeToken(old);
      const stored = upsert.mock.calls[0]?.[0];
      expect(stored).toEqual({
        token_hash: unsubscribeTokenHash(old),
        user_id: USER,
        scope,
      });
      expect(JSON.stringify(stored)).not.toContain(old);
      vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'new-test-signing-key');
      expect(await resolveUnsubscribeToken(old)).toEqual({
        userId: USER,
        scope,
      });
    },
  );

  it('accepts a valid new signature without needing the recovery store', async () => {
    expect(await resolveUnsubscribeToken(mintUnsubscribeToken(USER))).toEqual({
      userId: USER,
      scope: 'all',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects changed payloads, signatures, unknown hashes and mismatched stored claims', async () => {
    const old = mintUnsubscribeToken(USER, 'alerts');
    await rememberUnsubscribeToken(old);
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'new-test-signing-key');
    const otherPayload = Buffer.from(`${USER}.all`).toString('base64url');
    expect(
      await resolveUnsubscribeToken(`${otherPayload}.${old.split('.')[1]}`),
    ).toBeNull();
    const last = old.endsWith('A') ? 'B' : 'A';
    expect(await resolveUnsubscribeToken(old.slice(0, -1) + last)).toBeNull();
    rows.set(unsubscribeTokenHash(old), { user_id: USER, scope: 'all' });
    expect(await resolveUnsubscribeToken(old)).toBeNull();
  });

  it('cannot register a forged token and does not query storage for malformed input', async () => {
    expect(await resolveUnsubscribeToken('bad')).toBeNull();
    expect(await resolveUnsubscribeToken('x'.repeat(1000))).toBeNull();
    expect(from).not.toHaveBeenCalled();
    const old = mintUnsubscribeToken(USER);
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'different-key');
    await expect(rememberUnsubscribeToken(old)).rejects.toThrow('invalid');
    expect(upsert).not.toHaveBeenCalled();
  });

  it('surfaces storage failures instead of treating them as an invalid link', async () => {
    const old = mintUnsubscribeToken(USER);
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'different-key');
    lookup.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await expect(resolveUnsubscribeToken(old)).rejects.toThrow('unavailable');
  });

  it('stops durable queue insertion when token persistence fails', async () => {
    upsert.mockResolvedValue({ error: { message: 'offline' } });
    await expect(
      enqueueEmail({
        userId: USER,
        notifications: [],
        message: {
          to: 'test@example.test',
          subject: 'Test',
          html: 'Test',
          text: 'Test',
          unsubscribeToken: mintUnsubscribeToken(USER),
        },
        minimumAccessRank: 0,
        alertType: 'weekly_report',
      }),
    ).rejects.toThrow('preserve');
    expect(rpc).not.toHaveBeenCalled();
  });
});
