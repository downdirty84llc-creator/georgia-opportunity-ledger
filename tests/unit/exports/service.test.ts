import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  update: vi.fn(),
  prepare: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload }) },
    from: () => ({
      update: (value: unknown) => {
        mocks.update(value);
        const query = {
          eq: () => query,
          is: () => query,
          select: () => query,
          maybeSingle: mocks.prepare,
          then: (resolve: (value: unknown) => void) =>
            mocks.failure().then(resolve),
        };
        return query;
      },
    }),
  }),
}));
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://example.test' },
  serverEnv: () => ({ storageBuckets: { exports: 'exports' } }),
}));
import { runExportJob, type ExportJobRow } from '@/lib/exports/service';

const job = { id: 'job-1', user_id: 'member-1' } as ExportJobRow;
let claim: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  claim = {
    ...job,
    lease_token: 'token',
    prepared_csv: null,
    row_count: null,
    attempts: 1,
    file_path: 'member-1/job-1.csv',
    truncated: false,
  };
  mocks.rpc.mockImplementation(async (name: string) => ({
    data:
      name === 'claim_export_job'
        ? claim
        : name === 'export_opportunity_data'
          ? { rows: [], accessRank: 30, truncated: false }
          : true,
    error: null,
  }));
  mocks.upload.mockResolvedValue({ error: null });
  mocks.prepare.mockResolvedValue({ data: { id: job.id }, error: null });
  mocks.failure.mockResolvedValue({ error: null });
});

describe('durable export uploads', () => {
  it('does no work when a concurrent worker owns the claim', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await runExportJob(job)).toBeNull();
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('persists bytes before starting an upload', async () => {
    mocks.upload.mockImplementation(async () => {
      expect(mocks.prepare).toHaveBeenCalled();
      return { error: null };
    });
    expect(await runExportJob(job)).toEqual({
      rowCount: 0,
      filePath: 'member-1/job-1.csv',
      truncated: false,
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      'member-1/job-1.csv',
      expect.any(Blob),
      { contentType: 'text/csv', upsert: true },
    );
  });
  it('reuses identical bytes after an upload response was lost', async () => {
    claim.prepared_csv = 'immutable previous CSV';
    claim.row_count = 42;
    await runExportJob(job);
    expect(
      mocks.rpc.mock.calls.some(
        (call) => call[0] === 'export_opportunity_data',
      ),
    ).toBe(false);
    expect(await (mocks.upload.mock.calls[0]?.[1] as Blob).text()).toBe(
      'immutable previous CSV',
    );
  });
  it('will not upload when snapshot persistence fails', async () => {
    mocks.prepare.mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
    });
    await expect(runExportJob(job)).rejects.toThrow(
      'Could not persist export snapshot',
    );
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('queues a recoverable retry on storage failure', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'timeout' } });
    await expect(runExportJob(job)).rejects.toThrow('Export upload failed');
    expect(mocks.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'queued' }),
    );
    expect(
      mocks.rpc.mock.calls.some((call) => call[0] === 'finish_export_job'),
    ).toBe(false);
  });
  it('does not report ready when completion is refused', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'claim_export_job'
          ? { ...claim, prepared_csv: 'bytes' }
          : false,
      error: null,
    }));
    await expect(runExportJob(job)).rejects.toThrow(
      'claim expired or access changed',
    );
  });
  it('surfaces both the original error and a failed recovery write', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'upload timeout' } });
    mocks.failure.mockResolvedValue({
      error: { message: 'database unavailable' },
    });
    await expect(runExportJob(job)).rejects.toThrow(
      'retry state could not be saved',
    );
  });
});
