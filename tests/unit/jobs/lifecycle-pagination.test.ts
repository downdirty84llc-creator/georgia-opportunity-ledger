import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({ from, rpc }) }));
const { evaluateDeadlinesJob } = await import('@/lib/jobs/lifecycle-jobs');
const { aggregateAnalyticsJob } = await import('@/lib/jobs/maintenance-jobs');
const now = new Date('2026-10-13T14:00:00Z');

describe('bounded lifecycle and complete analytics work', () => {
  beforeEach(() => vi.resetAllMocks());

  it('reaches records beyond row 1,000 and updates opening-only records with a concurrency fence', async () => {
    const rows = Array.from({ length: 1003 }, (_, i) => ({
      id: String(i).padStart(5, '0'),
      status: i === 1002 ? 'upcoming' : 'open',
      closing_date: null,
      opening_date: '2026-10-01T00:00:00Z',
      is_expired: false,
      is_closing_soon: false,
      updated_at: '2026-10-01T00:00:00Z',
    }));
    const updates: { values: unknown; filters: Record<string, unknown> }[] = [];
    from.mockImplementation(() => {
      let after = '';
      let update: unknown;
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        order: () => q,
        limit: () => q,
        eq: (key: string, value: unknown) => {
          filters[key] = value;
          return q;
        },
        gt: (_key: string, value: string) => {
          after = value;
          return q;
        },
        update: (values: unknown) => {
          update = values;
          return q;
        },
        then: (resolve: (value: unknown) => unknown) => {
          if (update) updates.push({ values: update, filters });
          return Promise.resolve({
            data: update
              ? [{ id: filters.id }]
              : rows.filter((row) => row.id > after).slice(0, 50),
            error: null,
          }).then(resolve);
        },
      };
      return q;
    });
    const checkpoint = vi.fn(async () => {});
    const result = await evaluateDeadlinesJob.handler({
      now,
      note: vi.fn(),
      checkpoint,
    });
    expect(result.processed).toBe(1);
    expect(updates).toEqual([
      {
        values: expect.objectContaining({ status: 'open' }),
        filters: {
          id: '01002',
          updated_at: '2026-10-01T00:00:00Z',
          workflow_status: 'published',
        },
      },
    ]);
    expect(checkpoint).toHaveBeenCalledWith({ after: '00999' });
    expect(checkpoint).toHaveBeenLastCalledWith({});
  });

  it('reports full SQL counts for the previous UTC calendar day', async () => {
    rpc.mockResolvedValue({
      data: { total: 22001, counts: { view: 22001 } },
      error: null,
    });
    const result = await aggregateAnalyticsJob.handler({ now, note: vi.fn() });
    expect(rpc).toHaveBeenCalledWith('aggregate_analytics_window', {
      p_start: '2026-10-12T00:00:00.000Z',
      p_end: '2026-10-13T00:00:00.000Z',
    });
    expect(result.processed).toBe(22001);
    expect(from).not.toHaveBeenCalled();
  });
});
