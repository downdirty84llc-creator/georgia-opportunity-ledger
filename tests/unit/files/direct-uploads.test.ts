import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  viewer: vi.fn(),
  rate: vi.fn(),
  rpc: vi.fn(),
  storage: vi.fn(),
  from: vi.fn(),
  signed: vi.fn(),
  download: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  operations: [] as Array<{
    table: string;
    action: string;
    value?: unknown;
    filters: unknown[];
  }>,
  results: new Map<string, { data: unknown; error: unknown }>(),
}));
vi.mock('@/lib/auth/session', () => ({ getViewer: mocks.viewer }));
vi.mock('@/lib/http/rate-limit', () => ({
  checkRateLimit: mocks.rate,
  rateLimitIdentity: () => 'owner',
}));
vi.mock('@/lib/env', () => ({
  serverEnv: () => ({
    maxUploadBytes: 26_214_400,
    storageBuckets: { attachments: 'attachments' },
  }),
}));
vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: mocks.from,
    rpc: mocks.rpc,
    storage: { from: mocks.storage },
  }),
}));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({ from: mocks.from }),
}));
import {
  finishAttachmentUpload,
  cleanupAttachmentUploads,
} from '@/lib/files/direct-uploads';
import { POST as begin } from '@/app/api/v1/admin/attachments/uploads/route';
import { POST as finish } from '@/app/api/v1/admin/attachments/uploads/complete/route';

const id = '12345678-1234-4234-8234-123456789012';
const owner = '12345678-1234-4234-8234-123456789013';
const parent = '12345678-1234-4234-8234-123456789014';
const intent = {
  id,
  uploaded_by: owner,
  parent_type: 'report',
  parent_id: parent,
  file_name: 'report.pdf',
  mime_type: 'application/pdf',
  file_size: 8,
  minimum_access_rank: 20,
  status: 'waiting',
};
const metadata = {
  fileName: 'report.pdf',
  mimeType: 'application/pdf',
  fileSize: 8,
  minimumAccessRank: 20,
  reportId: parent,
  opportunityId: null,
};
const request = (body: unknown) =>
  new Request('https://ledger.example/api/v1/admin/attachments/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.results.clear();
  mocks.operations.length = 0;
  mocks.viewer.mockResolvedValue({
    isAuthenticated: true,
    isStaff: true,
    accountStatus: 'active',
    role: 'editor',
    userId: owner,
  });
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.results.set('reports:select', { data: { id: parent }, error: null });
  mocks.results.set('attachment_uploads:select', { data: intent, error: null });
  mocks.rpc.mockImplementation(async (name: string) => ({
    data: name === 'claim_attachment_upload' ? [intent] : id,
    error: null,
  }));
  mocks.download.mockResolvedValue({
    data: new Blob(['%PDF-1.7']),
    error: null,
  });
  mocks.signed.mockResolvedValue({
    data: { token: 'temporary-upload-token' },
    error: null,
  });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.remove.mockResolvedValue({ error: null });
  mocks.storage.mockReturnValue({
    createSignedUploadUrl: mocks.signed,
    download: mocks.download,
    upload: mocks.upload,
    remove: mocks.remove,
  });
  mocks.from.mockImplementation((table: string) => {
    const operation = {
      table,
      action: 'select',
      value: undefined as unknown,
      filters: [] as unknown[],
    };
    mocks.operations.push(operation);
    const result = () =>
      mocks.results.get(table + ':' + operation.action) ?? {
        data: null,
        error: null,
      };
    const chain = {
      select: () => chain,
      insert: (value: unknown) => {
        operation.action = 'insert';
        operation.value = value;
        return chain;
      },
      update: (value: unknown) => {
        operation.action = 'update';
        operation.value = value;
        return chain;
      },
      delete: () => {
        operation.action = 'delete';
        return chain;
      },
      eq: (...args: unknown[]) => {
        operation.filters.push(args);
        return chain;
      },
      lt: (...args: unknown[]) => {
        operation.filters.push(args);
        return chain;
      },
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => result(),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve),
    };
    return chain;
  });
});
describe('direct upload access', () => {
  it.each([
    {
      isAuthenticated: false,
      isStaff: false,
      role: 'member',
      accountStatus: 'active',
    },
    {
      isAuthenticated: true,
      isStaff: false,
      role: 'member',
      accountStatus: 'active',
    },
    {
      isAuthenticated: true,
      isStaff: true,
      role: 'support_representative',
      accountStatus: 'active',
    },
    {
      isAuthenticated: true,
      isStaff: true,
      role: 'editor',
      accountStatus: 'suspended',
    },
  ])(
    'refuses non-editorial or inactive callers on both endpoints (%j)',
    async (viewer) => {
      mocks.viewer.mockResolvedValue(viewer);
      expect((await begin(request(metadata), undefined as never)).status).toBe(
        403,
      );
      expect(
        (await finish(request({ uploadId: id }), undefined as never)).status,
      ).toBe(403);
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.storage).not.toHaveBeenCalled();
    },
  );
  it('rejects caller-supplied owner IDs and paths', async () => {
    expect(
      (
        await begin(
          request({ ...metadata, uploadedBy: 'other', path: 'clean-file.pdf' }),
          undefined as never,
        )
      ).status,
    ).toBe(422);
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it('requires a visible parent before issuing an upload token', async () => {
    mocks.results.set('reports:select', { data: null, error: null });
    expect((await begin(request(metadata), undefined as never)).status).toBe(
      404,
    );
    expect(mocks.signed).not.toHaveBeenCalled();
  });
  it('signs a non-overwriting staging path owned by the session', async () => {
    const response = await begin(request(metadata), undefined as never);
    expect(response.status).toBe(201);
    const data = (await response.json()).data;
    expect(data.bucket).toBe('attachment-uploads');
    expect(mocks.signed).toHaveBeenCalledWith(data.uploadId, { upsert: false });
    expect(
      mocks.operations.find((x) => x.action === 'insert')?.value,
    ).toMatchObject({ uploaded_by: owner, parent_id: parent });
  });
  it('honors rate limits before issuing credentials', async () => {
    mocks.rate.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 1000),
    });
    expect((await begin(request(metadata), undefined as never)).status).toBe(
      429,
    );
    expect(mocks.signed).not.toHaveBeenCalled();
  });
});
describe('validation and finalize retries', () => {
  it('refuses another owner before touching storage', async () => {
    mocks.results.set('attachment_uploads:select', { data: null, error: null });
    await expect(finishAttachmentUpload(id, 'other')).rejects.toThrow(
      'Upload not found',
    );
    expect(mocks.operations[0]!.filters).toContainEqual([
      'uploaded_by',
      'other',
    ]);
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it('does not finalize expired or concurrently claimed uploads', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(finishAttachmentUpload(id, owner)).rejects.toThrow('expired');
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it('rejects a forged size before making a member attachment', async () => {
    mocks.download.mockResolvedValue({
      data: new Blob(['%PDF-1.7 extra']),
      error: null,
    });
    await expect(finishAttachmentUpload(id, owner)).rejects.toThrow('size');
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(
      mocks.operations.find((x) => x.action === 'update')?.value,
    ).toMatchObject({ status: 'rejected' });
  });
  it('rejects executable bytes declared as PDF', async () => {
    mocks.download.mockResolvedValue({
      data: new Blob(['MZbadexe']),
      error: null,
    });
    await expect(finishAttachmentUpload(id, owner)).rejects.toThrow();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_attachment_upload',
      expect.anything(),
    );
  });
  it('validates a 25 MiB file and queues it without marking it clean', async () => {
    const bytes = new Uint8Array(26_214_400);
    bytes.set(new TextEncoder().encode('%PDF-1.7'));
    mocks.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
    mocks.rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'claim_attachment_upload'
          ? [{ ...intent, file_size: bytes.length }]
          : id,
      error: null,
    }));
    expect(await finishAttachmentUpload(id, owner)).toEqual({
      id,
      scanStatus: 'pending',
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      `reports/${parent}/${id}-report.pdf`,
      expect.any(Uint8Array),
      { contentType: 'application/pdf', upsert: false },
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'complete_attachment_upload',
      expect.objectContaining({
        p_checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });
  it('recovers a stored immutable object after a lost finalize response', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'already exists' } });
    await expect(finishAttachmentUpload(id, owner)).resolves.toEqual({
      id,
      scanStatus: 'pending',
    });
    expect(mocks.upload).toHaveBeenCalledTimes(1);
  });
  it('uses the canonical opportunity directory for final bytes', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({
      data:
        name === 'claim_attachment_upload'
          ? [{ ...intent, parent_type: 'opportunity' }]
          : id,
      error: null,
    }));
    await finishAttachmentUpload(id, owner);
    expect(mocks.upload).toHaveBeenCalledWith(
      `opportunities/${parent}/${id}-report.pdf`,
      expect.any(Uint8Array),
      { contentType: 'application/pdf', upsert: false },
    );
  });
  it('refuses to reuse different bytes at the final object path', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'already exists' } });
    mocks.download
      .mockResolvedValueOnce({ data: new Blob(['%PDF-1.7']), error: null })
      .mockResolvedValueOnce({ data: new Blob(['%PDF-1.6']), error: null });
    await expect(finishAttachmentUpload(id, owner)).rejects.toThrow(
      'already exists',
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('returns an existing completed upload without writing another object', async () => {
    mocks.results.set('attachment_uploads:select', {
      data: { ...intent, status: 'completed' },
      error: null,
    });
    mocks.results.set('attachments:select', {
      data: { scan_status: 'clean' },
      error: null,
    });
    expect(await finishAttachmentUpload(id, owner)).toEqual({
      id,
      scanStatus: 'clean',
    });
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not resurrect an attachment deleted after finalization', async () => {
    mocks.results.set('attachment_uploads:select', {
      data: { ...intent, status: 'completed' },
      error: null,
    });
    await expect(finishAttachmentUpload(id, owner)).rejects.toThrow('deleted');
    expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('preserves temporary cleanup records when storage deletion fails', async () => {
    mocks.results.set('attachment_uploads:select', {
      data: [intent],
      error: null,
    });
    mocks.remove.mockResolvedValue({
      error: { message: 'storage unavailable' },
    });
    await expect(cleanupAttachmentUploads(Date.now() + 10000)).rejects.toThrow(
      'storage unavailable',
    );
    expect(mocks.operations.some((x) => x.action === 'delete')).toBe(false);
  });
});
