import { beforeEach, describe, expect, it, vi } from 'vitest';

const { detail, lookup, eq } = vi.hoisted(() => ({
  detail: vi.fn(),
  lookup: vi.fn(),
  eq: vi.fn(),
}));
vi.mock('@/lib/auth/session', () => ({
  getViewer: async () => ({ userId: null, planCode: 'free' }),
}));
vi.mock('@/lib/opportunities/query', () => ({ loadOpportunityDetail: detail }));
vi.mock('@/lib/analytics/events', () => ({ track: vi.fn() }));
vi.mock('@/lib/observability/report-error', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => {
          eq(column, value);
          return { maybeSingle: lookup };
        },
      }),
    }),
  }),
}));
const { GET } = await import('@/app/api/v1/opportunities/[idOrSlug]/route');
const request = (idOrSlug: string) =>
  GET(new Request('https://ledger.example/api/v1/opportunities/example'), {
    params: Promise.resolve({ idOrSlug }),
  } as never);

describe('locked opportunity preview lookup', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    detail.mockResolvedValue(null);
    lookup.mockResolvedValue({
      data: { id: 'record', slug: 'funding-award', minimum_access_rank: 20 },
      error: null,
    });
  });
  it('loads a locked record by slug without comparing it to a UUID column', async () => {
    const response = await request('funding-award');
    expect(response.status).toBe(200);
    expect(eq).toHaveBeenCalledWith('slug', 'funding-award');
    expect((await response.json()).data.access.canViewFull).toBe(false);
  });
  it('uses a UUID as an id', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    await request(id);
    expect(eq).toHaveBeenCalledWith('id', id);
  });
  it('passes filter punctuation as a literal slug value', async () => {
    lookup.mockResolvedValue({ data: null, error: null });
    const slug = 'example,id.not.is.null';
    expect((await request(slug)).status).toBe(404);
    expect(eq).toHaveBeenCalledWith('slug', slug);
  });
  it('does not disguise a database failure as a missing record', async () => {
    lookup.mockResolvedValue({
      data: null,
      error: { message: 'database unavailable' },
    });
    expect((await request('funding-award')).status).toBe(500);
  });
});
