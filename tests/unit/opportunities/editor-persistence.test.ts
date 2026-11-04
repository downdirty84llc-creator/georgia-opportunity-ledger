import { describe, expect, it, vi } from 'vitest';

import {
  createEditorSaveQueue,
  saveThenRunWorkflow,
} from '@/lib/opportunities/editor-persistence';

describe('editor save before workflow', () => {
  it('finishes an older autosave before saving and publishing the latest changes', async () => {
    const queue = createEditorSaveQueue();
    let finishFirst!: (id: string) => void;
    const oldSave = new Promise<string>((resolve) => {
      finishFirst = resolve;
    });
    const nextSave = vi.fn(async () => 'current-id');
    const publish = vi.fn(async () => 'published');
    const first = queue(() => oldSave);
    const result = saveThenRunWorkflow(() => queue(nextSave), publish);
    await Promise.resolve();
    expect(nextSave).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    finishFirst('current-id');
    await first;
    expect(await result).toEqual({ saved: true, result: 'published' });
    expect(publish).toHaveBeenCalledExactlyOnceWith('current-id');
  });

  it('allows a corrected save after an earlier network failure', async () => {
    const queue = createEditorSaveQueue();
    await expect(
      queue(async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');
    expect(await queue(async () => 'recovered-id')).toBe('recovered-id');
  });

  it('does not publish an older record when the latest save fails', async () => {
    const publish = vi.fn();
    expect(await saveThenRunWorkflow(async () => null, publish)).toEqual({
      saved: false,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('waits for persistence and uses the newly created record ID', async () => {
    let finishSave!: (id: string) => void;
    const save = new Promise<string>((resolve) => {
      finishSave = resolve;
    });
    const publish = vi.fn(async (id: string) => ({ id, status: 'published' }));
    const result = saveThenRunWorkflow(() => save, publish);
    expect(publish).not.toHaveBeenCalled();
    finishSave('new-record-id');
    expect(await result).toEqual({
      saved: true,
      result: { id: 'new-record-id', status: 'published' },
    });
    expect(publish).toHaveBeenCalledExactlyOnceWith('new-record-id');
  });

  it('does not run the workflow after an unexpected save exception', async () => {
    const publish = vi.fn();
    await expect(
      saveThenRunWorkflow(async () => {
        throw new Error('offline');
      }, publish),
    ).rejects.toThrow('offline');
    expect(publish).not.toHaveBeenCalled();
  });

  it('preserves workflow rejection for the caller to display', async () => {
    await expect(
      saveThenRunWorkflow(
        async () => 'saved-id',
        async () => {
          throw new Error('review required');
        },
      ),
    ).rejects.toThrow('review required');
  });
});
