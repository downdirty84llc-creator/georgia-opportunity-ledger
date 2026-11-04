import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  update: vi.fn(),
  lookup: vi.fn(),
  rpc: vi.fn(),
  viewer: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({ getViewer: m.viewer }));
vi.mock('@/lib/auth/mfa', () => ({
  mfaRequiredForRole: () => true,
  getMfaStatus: async () => ({ state: 'satisfied' }),
}));
vi.mock('@/lib/observability/report-error', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: m.lookup }) }),
      update: (values: unknown) => {
        m.update(values);
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: { id: 'report', ...(values as object) },
                error: null,
              }),
            }),
          }),
        };
      },
    }),
    rpc: m.rpc,
  }),
}));
const { POST } = await import('@/app/api/v1/admin/reports/[id]/publish/route');
const publish = (body: object) =>
  POST(
    new Request('https://ledger.example/api/v1/admin/reports/report/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://ledger.example',
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'report' }) } as never,
  );

describe('report publication email choice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.viewer.mockResolvedValue({
      isAuthenticated: true,
      role: 'editor',
      accountStatus: 'active',
      userId: 'editor',
    });
    m.lookup.mockResolvedValue({
      data: {
        id: 'report',
        status: 'draft',
        title: 'Weekly',
        executive_summary: 'Verified briefing',
      },
      error: null,
    });
    m.rpc.mockResolvedValue({ error: null });
  });
  it.each([{}, { distributeByEmail: false }])(
    'persists a web-only publication by default: %j',
    async (body) => {
      const response = await publish(body);
      expect(response.status).toBe(200);
      expect(m.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'published',
          email_distribution_enabled: false,
        }),
      );
      expect((await response.json()).data.distributionQueued).toBe(false);
    },
  );
  it('persists an explicit email request', async () => {
    const response = await publish({ distributeByEmail: true });
    expect(response.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({ email_distribution_enabled: true }),
    );
    expect((await response.json()).data.distributionQueued).toBe(true);
  });
  it('retains opt-in for a scheduled report without claiming immediate queuing', async () => {
    const response = await publish({
      distributeByEmail: true,
      scheduledAt: '2099-01-01T12:00:00Z',
    });
    expect(response.status).toBe(200);
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'scheduled',
        published_at: null,
        email_distribution_enabled: true,
      }),
    );
    expect((await response.json()).data.distributionQueued).toBe(false);
  });
  it('does not allow a researcher to enable report delivery', async () => {
    m.viewer.mockResolvedValue({
      isAuthenticated: true,
      role: 'researcher',
      accountStatus: 'active',
    });
    expect((await publish({ distributeByEmail: true })).status).toBe(403);
    expect(m.update).not.toHaveBeenCalled();
  });
});
