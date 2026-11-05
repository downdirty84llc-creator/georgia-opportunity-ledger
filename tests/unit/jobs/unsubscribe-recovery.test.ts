import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mintUnsubscribeToken } from '@/lib/email/unsubscribe';
import { unsubscribeTokenHash } from '@/lib/email/unsubscribe-registry';
const { from, pages, upsert, checkpoint, cursors } = vi.hoisted(() => ({
  from: vi.fn(),
  pages: [] as { id: string }[][],
  upsert: vi.fn(),
  checkpoint: vi.fn(),
  cursors: [] as string[],
}));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({ from }) }));
const { checkpointUnsubscribeTokensJob: job } =
  await import('@/lib/jobs/unsubscribe-recovery');
const { findJob, JOBS } = await import('@/lib/jobs/registry');
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
beforeEach(() => {
  vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'old-signing-key');
  pages.length = 0;
  cursors.length = 0;
  from.mockReset();
  checkpoint.mockReset();
  upsert.mockReset();
  upsert.mockResolvedValue({ error: null });
  from.mockImplementation((table) => {
    if (table === 'email_unsubscribe_tokens') return { upsert };
    const query = {
      select: () => query,
      order: () => query,
      limit: () => query,
      gt: (_: string, value: string) => {
        cursors.push(value);
        return query;
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: pages.shift() ?? [], error: null }).then(
          resolve,
        ),
    };
    return query;
  });
});
afterEach(() => vi.unstubAllEnvs());
describe('unsubscribe recovery checkpoint', () => {
  it('is available only as an operator-invoked job, with no recurring schedule', () => {
    expect(findJob(job.name)).toBe(job);
    expect(JOBS.some((row) => row.definition.name === job.name)).toBe(false);
  });
  it('paginates and preserves all three scopes, storing no raw token', async () => {
    pages.push(
      Array.from({ length: 200 }, (_, n) => ({ id: id(n + 1) })),
      [{ id: id(201) }],
    );
    const result = await job.handler({
      now: new Date(),
      note: vi.fn(),
      checkpoint,
    });
    expect(result).toMatchObject({
      processed: 201,
      failed: 0,
      detail: { complete: true },
    });
    expect(cursors).toEqual([id(200)]);
    expect(upsert.mock.calls[0]?.[0]).toHaveLength(600);
    expect(upsert.mock.calls[1]?.[0]).toHaveLength(3);
    expect(JSON.stringify(upsert.mock.calls)).not.toContain(
      mintUnsubscribeToken(id(1)),
    );
    expect(checkpoint.mock.calls.at(-1)?.[0]).toMatchObject({
      after: id(201),
      complete: true,
    });
  });
  it('resumes an interrupted pass only under the same signing key', async () => {
    const signer = unsubscribeTokenHash(
      mintUnsubscribeToken('00000000-0000-0000-0000-000000000000'),
    );
    const state = { signer, after: id(200), complete: false };
    await job.handler({ now: new Date(), note: vi.fn(), checkpoint, state });
    expect(cursors).toEqual([id(200)]);
    cursors.length = 0;
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'new-signing-key');
    await job.handler({ now: new Date(), note: vi.fn(), checkpoint, state });
    expect(cursors).toEqual([]);
  });
  it('never advances the checkpoint past a failed write', async () => {
    pages.push([{ id: id(1) }]);
    upsert.mockResolvedValue({ error: { message: 'offline' } });
    await expect(
      job.handler({ now: new Date(), note: vi.fn(), checkpoint }),
    ).rejects.toThrow('checkpoint');
    expect(checkpoint).not.toHaveBeenCalled();
  });
  it('reports an incomplete pass when its budget is exhausted', async () => {
    const result = await job.handler({
      now: new Date(),
      note: vi.fn(),
      checkpoint,
      deadlineAt: Date.now() - 1,
    });
    expect(result.detail.complete).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});
