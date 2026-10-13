import { beforeEach, describe, expect, it, vi } from 'vitest';

const { claim, finish, report } = vi.hoisted(() => ({
  claim: vi.fn(),
  finish: vi.fn(),
  report: vi.fn(),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    rpc: (name: string, input: { p_result?: unknown }) =>
      name === 'claim_job_run' ? claim(input) : finish(input.p_result),
  }),
}));
vi.mock('@/lib/observability/report-error', () => ({ reportError: report }));
const { runJob, dailyKey } = await import('@/lib/jobs/runner');
const now = new Date('2026-10-13T12:00:00Z');

describe('job outcomes and retry ownership', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    claim.mockResolvedValue({ data: { id: 'run-1', state: {} }, error: null });
    finish.mockResolvedValue({ data: true, error: null });
  });

  it('records partial failure, releases the window and rejects the run', async () => {
    const handler = vi.fn().mockResolvedValue({
      processed: 2,
      failed: 1,
      detail: { source: 'storage' },
    });
    await expect(
      runJob(
        { name: 'prune', description: '', idempotencyKey: dailyKey, handler },
        now,
      ),
    ).rejects.toThrow('1 record(s) failed');
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        records_processed: 2,
        records_failed: 1,
        detail: { source: 'storage', retryWindow: '2026-10-13' },
      }),
    );
    expect(report).toHaveBeenCalled();
  });

  it('allows a failed keyed job to execute again in the same window', async () => {
    let owned = false;
    claim.mockImplementation(async () => {
      if (owned) return { data: null, error: null };
      owned = true;
      return { data: { id: 'run-1', state: {} }, error: null };
    });
    finish.mockImplementation(async (values) => {
      if (values.status === 'failed') owned = false;
      return { data: true, error: null };
    });
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValue({ processed: 1, failed: 0, detail: {} });
    const job = {
      name: 'prune',
      description: '',
      idempotencyKey: dailyKey,
      handler,
    };
    await expect(runJob(job, now)).rejects.toThrow('provider unavailable');
    expect((await runJob(job, now)).processed).toBe(1);
    expect((await runJob(job, now)).skipped).toBe(true);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('does not run a handler when another invocation owns the window', async () => {
    claim.mockResolvedValue({ data: null, error: null });
    const handler = vi.fn();
    expect(
      (await runJob({ name: 'job', description: '', handler }, now)).skipped,
    ).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not report success when persistence fails', async () => {
    finish.mockResolvedValueOnce({
      error: { message: 'database unavailable' },
    });
    await expect(
      runJob(
        {
          name: 'job',
          description: '',
          handler: async () => ({ processed: 1, failed: 0, detail: {} }),
        },
        now,
      ),
    ).rejects.toThrow('Could not finish job run');
    expect(finish).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
