import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupExpiredExports } from '@/lib/exports/cleanup';

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({ storageBuckets: { exports: 'exports' } }),
}));

describe('expired export cleanup', () => {
  const path = 'member/export.csv';
  const jobs = [{ id: 'export-1', file_path: path }];
  const remove = vi.fn();
  const update = vi.fn();
  const list = vi.fn();
  function client() {
    const query = {
      select: () => query,
      in: () => query,
      lt: () => query,
      or: () => query,
      order: () => query,
      limit: list,
      update: (values: unknown) => ({
        eq: (key: string, id: string) => update(values, key, id),
      }),
    };
    return {
      from: () => query,
      storage: { from: () => ({ remove }) },
    } as unknown as Parameters<typeof cleanupExpiredExports>[0];
  }
  const run = () =>
    cleanupExpiredExports(client(), new Date('2026-10-13T12:00:00Z'));
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    list.mockResolvedValue({ data: jobs, error: null });
    remove.mockResolvedValue({ error: null });
    update.mockResolvedValue({ error: null });
  });
  afterEach(() => vi.restoreAllMocks());

  it('deletes the stored file before clearing its reference', async () => {
    update.mockImplementation(async () => {
      expect(remove).toHaveBeenCalledWith([path]);
      return { error: null };
    });
    expect(await run()).toEqual({ expired: 1, failed: 0 });
    expect(update).toHaveBeenCalledWith(
      { status: 'expired', file_path: null },
      'id',
      'export-1',
    );
  });
  it('retains the reference on storage failure so a later run can retry', async () => {
    remove.mockResolvedValueOnce({ error: { message: 'storage unavailable' } });
    expect(await run()).toEqual({ expired: 0, failed: 1 });
    expect(update).not.toHaveBeenCalled();
    expect(await run()).toEqual({ expired: 1, failed: 0 });
  });
  it('continues with other files after one storage failure', async () => {
    list.mockResolvedValue({
      data: [...jobs, { id: 'export-2', file_path: 'member/second.csv' }],
      error: null,
    });
    remove.mockRejectedValueOnce(new Error('network unavailable'));
    expect(await run()).toEqual({ expired: 1, failed: 1 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith(
      expect.anything(),
      'id',
      'export-2',
    );
  });
  it('counts a failed database update as failure', async () => {
    update.mockResolvedValueOnce({
      error: { message: 'database unavailable' },
    });
    expect(await run()).toEqual({ expired: 0, failed: 1 });
  });
  it('does not mistake a listing error for no expired files', async () => {
    list.mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
    });
    await expect(run()).rejects.toThrow('Could not list expired exports');
    expect(remove).not.toHaveBeenCalled();
  });
});
