import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), bucket: vi.fn() }));
vi.mock('@/lib/db/browser', () => ({
  createBrowserSupabaseClient: () => ({ storage: { from: mocks.bucket } }),
}));
import { uploadAttachmentFromBrowser } from '@/lib/files/browser-upload';

const fetchMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  mocks.bucket.mockReturnValue({ uploadToSignedUrl: mocks.upload });
  mocks.upload.mockResolvedValue({ error: null });
  fetchMock
    .mockResolvedValueOnce(
      Response.json({
        data: {
          uploadId: 'reserved-id',
          bucket: 'attachment-uploads',
          path: 'reserved-id',
          token: 'signed-token',
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ data: { message: 'Queued for scanning.' } }),
    );
});
afterEach(() => vi.unstubAllGlobals());

it('transfers 25 MiB directly to Storage and keeps both application requests small', async () => {
  const bytes = new Uint8Array(26_214_400);
  bytes.set(new TextEncoder().encode('%PDF-1.7'));
  const file = new File([bytes], 'large.pdf', { type: 'application/pdf' });
  expect(
    await uploadAttachmentFromBrowser(file, {
      minimumAccessRank: 20,
      reportId: 'report-id',
    }),
  ).toBe('Queued for scanning.');
  expect(mocks.bucket).toHaveBeenCalledWith('attachment-uploads');
  expect(mocks.upload).toHaveBeenCalledWith(
    'reserved-id',
    'signed-token',
    file,
    { contentType: 'application/pdf' },
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [, init] of fetchMock.mock.calls) {
    expect(typeof init.body).toBe('string');
    expect(new TextEncoder().encode(init.body).byteLength).toBeLessThan(1024);
    expect(init.headers['Content-Type']).toBe('application/json');
  }
  expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({
    fileSize: bytes.length,
    reportId: 'report-id',
  });
  expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({
    uploadId: 'reserved-id',
  });
});

it('does not finalize when the direct transfer fails', async () => {
  mocks.upload.mockResolvedValue({
    error: { message: 'transfer interrupted' },
  });
  await expect(
    uploadAttachmentFromBrowser(
      new File(['%PDF-1.7'], 'a.pdf', { type: 'application/pdf' }),
      { minimumAccessRank: 0, reportId: 'report-id' },
    ),
  ).rejects.toThrow('transfer did not finish');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('does not send bytes after the application refuses the reservation', async () => {
  fetchMock
    .mockReset()
    .mockResolvedValue(
      Response.json(
        { error: { message: 'Sign in as an editor.' } },
        { status: 403 },
      ),
    );
  await expect(
    uploadAttachmentFromBrowser(new File(['x'], 'a.pdf'), {
      minimumAccessRank: 0,
      reportId: 'report-id',
    }),
  ).rejects.toThrow('Sign in');
  expect(mocks.upload).not.toHaveBeenCalled();
});
