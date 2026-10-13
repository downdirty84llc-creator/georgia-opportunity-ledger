import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildViewer } from '@/lib/access/entitlements';

const mock = vi.hoisted(() => ({
  viewer: vi.fn(),
  read: vi.fn(),
  sign: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getViewer: mock.viewer }));
vi.mock('@/lib/exports/service', () => ({ signExportDownload: mock.sign }));
vi.mock('@/lib/observability/report-error', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: mock.read,
      };
      return query;
    },
  }),
}));
import { GET } from '@/app/api/v1/exports/[id]/route';

const id = 'eeeeeeee-0000-4000-8000-000000000001';
const call = (exportId = id) =>
  GET(new Request(`https://example.test/api/v1/exports/${exportId}`), {
    params: Promise.resolve({ id: exportId }),
  } as never);
const viewer = (rank: number) =>
  buildViewer(
    {
      userId: 'member',
      role: 'member',
      accountStatus: 'active',
      accessRankOverride: null,
      accessRankOverrideExpiresAt: null,
    },
    {
      status: 'active',
      planAccessRank: rank,
      currentPeriodEnd: new Date(Date.now() + 86400000),
      cancelAtPeriodEnd: false,
    },
    null,
  );
beforeEach(() => {
  vi.resetAllMocks();
  mock.viewer.mockResolvedValue(viewer(30));
  mock.read.mockResolvedValue({
    data: {
      id,
      status: 'ready',
      file_path: 'member/job.csv',
      row_count: 3,
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    },
    error: null,
  });
  mock.sign.mockResolvedValue('https://example.test/signed');
});
describe('export download entitlement', () => {
  it('refuses a former Premium member before looking up a file', async () => {
    mock.viewer.mockResolvedValue(viewer(10));
    expect((await call()).status).toBe(402);
    expect(mock.read).not.toHaveBeenCalled();
    expect(mock.sign).not.toHaveBeenCalled();
  });
  it('validates identifiers before querying the database', async () => {
    expect((await call('not-a-uuid')).status).toBe(400);
    expect(mock.read).not.toHaveBeenCalled();
  });
  it('reports a database failure as an error, not a missing export', async () => {
    mock.read.mockResolvedValue({
      data: null,
      error: { message: 'database down' },
    });
    expect((await call()).status).toBe(500);
    expect(mock.sign).not.toHaveBeenCalled();
  });
  it('does not mint a URL for an expired export', async () => {
    mock.read.mockResolvedValue({
      data: {
        id,
        status: 'ready',
        file_path: 'path',
        expires_at: '2000-01-01',
      },
      error: null,
    });
    expect((await (await call()).json()).data.status).toBe('expired');
    expect(mock.sign).not.toHaveBeenCalled();
  });
  it('mints a fresh URL for an entitled member with a ready file', async () => {
    expect((await (await call()).json()).data.downloadUrl).toBe(
      'https://example.test/signed',
    );
    expect(mock.sign).toHaveBeenCalledWith('member/job.csv');
  });
});
