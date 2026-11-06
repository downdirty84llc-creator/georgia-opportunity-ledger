import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BLS_SERIES,
  BLS_URL,
  fetchBlsEmployment,
  parseBlsEmployment,
} from '@/lib/market/bls';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({ from }) }));
const { refreshMarketDataJob } = await import('@/lib/jobs/market-data-jobs');
const now = new Date('2026-11-06T13:10:00Z');
const payload = () => ({
  status: 'REQUEST_SUCCEEDED',
  Results: {
    series: [
      {
        seriesID: BLS_SERIES,
        data: [
          {
            year: '2026',
            period: 'M09',
            value: '231.8',
            footnotes: [{ code: 'P' }],
          },
          { year: '2026', period: 'M08', value: '232.2', footnotes: [{}] },
          { year: '2026', period: 'M07', value: '232.1', footnotes: [{}] },
        ],
      },
    ],
  },
});
const response = () =>
  new Response(JSON.stringify(payload()), {
    headers: { 'content-type': 'application/json' },
  });

describe('BLS employment feed', () => {
  it('sorts source periods, records provenance/preliminary status and derives comparisons from source values', () => {
    const rows = parseBlsEmployment(payload(), now);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      reporting_period_start: '2026-08-01',
      reporting_period_end: '2026-08-31',
      value: 232.2,
      previous_value: 232.1,
    });
    expect(rows[1]).toMatchObject({
      reporting_period_start: '2026-09-01',
      value: 231.8,
      previous_value: 232.2,
      is_sample: false,
      verified_at: now.toISOString(),
    });
    expect(rows[1]!.interpretation).toContain('Preliminary');
    expect(rows[1]!.source_url).toBe(
      `https://data.bls.gov/timeseries/${BLS_SERIES}`,
    );
  });

  it('refuses wrong series, missing months, duplicates, stale data and invalid/future values', () => {
    const wrong = payload();
    wrong.Results.series[0]!.seriesID = 'OTHER';
    expect(() => parseBlsEmployment(wrong, now)).toThrow();
    const gap = payload();
    gap.Results.series[0]!.data.splice(1, 1);
    expect(() => parseBlsEmployment(gap, now)).toThrow(/missing months/);
    const duplicate = payload();
    duplicate.Results.series[0]!.data.push(
      duplicate.Results.series[0]!.data[0]!,
    );
    expect(() => parseBlsEmployment(duplicate, now)).toThrow(/duplicate/);
    expect(() => parseBlsEmployment(payload(), new Date('2027-06-01'))).toThrow(
      /stale/,
    );
    expect(() => parseBlsEmployment(payload(), new Date('2026-08-01'))).toThrow(
      /bounds/,
    );
    for (const value of ['NaN', '-1', '0', '10001', '<script>']) {
      const invalid = payload();
      invalid.Results.series[0]!.data[0]!.value = value;
      expect(() => parseBlsEmployment(invalid, now)).toThrow();
    }
  });

  it('never treats annual averages as monthly observations', () => {
    const data = payload();
    data.Results.series[0]!.data.push({
      year: '2025',
      period: 'M13',
      value: '220',
      footnotes: [],
    });
    expect(parseBlsEmployment(data, now)).toHaveLength(2);
  });

  it('uses only the official fixed API with bounded requests and rejects provider failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(response());
    await fetchBlsEmployment(now, fetcher);
    expect(fetcher).toHaveBeenCalledWith(
      BLS_URL,
      expect.objectContaining({
        redirect: 'error',
        cache: 'no-store',
        signal: expect.any(AbortSignal),
      }),
    );
    await expect(
      fetchBlsEmployment(
        now,
        vi.fn().mockResolvedValue(new Response('{}', { status: 429 })),
      ),
    ).rejects.toThrow(/HTTP 429/);
    await expect(
      fetchBlsEmployment(
        now,
        vi.fn().mockResolvedValue(new Response('x'.repeat(128001))),
      ),
    ).rejects.toThrow(/size/);
  });
});

describe('market refresh job guards and retries', () => {
  afterEach(() => vi.unstubAllGlobals());
  const upsert = vi.fn(),
    update = vi.fn();
  let allowed = true,
    unit = 'thousands of jobs',
    writeError: { message: string } | null = null;
  beforeEach(() => {
    vi.resetAllMocks();
    allowed = true;
    unit = 'thousands of jobs';
    writeError = null;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => response()),
    );
    from.mockImplementation((table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({
          error: null,
          data:
            table === 'market_indicators'
              ? {
                  id: 'indicator',
                  source_id: 'source',
                  unit,
                  geographic_scope: 'Georgia',
                  description:
                    'Seasonally adjusted construction payroll employment in Georgia.',
                  is_active: true,
                  update_frequency: 'monthly',
                }
              : {
                  id: 'source',
                  is_active: true,
                  website_url: 'https://www.bls.gov',
                  automation_allowed: allowed,
                  scraping_review_status: 'permitted_with_limits',
                  terms_reviewed_at: '2026-11-06',
                },
        }),
        upsert: (...args: unknown[]) => {
          upsert(...args);
          return Promise.resolve({ error: writeError });
        },
        update: (...args: unknown[]) => {
          update(...args);
          return { eq: async () => ({ error: null }) };
        },
      };
      return q;
    });
  });
  it('requires reviewed permission and exact units before any provider call or writes', async () => {
    allowed = false;
    await expect(
      refreshMarketDataJob.handler({ now, note: vi.fn() }),
    ).rejects.toThrow(/permitted review/);
    allowed = true;
    unit = 'USD/ton';
    await expect(
      refreshMarketDataJob.handler({ now, note: vi.fn() }),
    ).rejects.toThrow(/metadata/);
    expect(fetch).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
  it('updates by stable indicator/period key and only marks the source checked after saving', async () => {
    await expect(
      refreshMarketDataJob.handler({ now, note: vi.fn() }),
    ).resolves.toMatchObject({ processed: 2, failed: 0 });
    expect(upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          indicator_id: 'indicator',
          previous_value: 232.2,
        }),
      ]),
      {
        onConflict: 'indicator_id,reporting_period_start,reporting_period_end',
      },
    );
    expect(update).toHaveBeenCalledWith({
      last_checked_at: now.toISOString(),
      next_check_at: '2026-11-07T13:10:00.000Z',
    });
    update.mockClear();
    writeError = { message: 'unavailable' };
    await expect(
      refreshMarketDataJob.handler({ now, note: vi.fn() }),
    ).rejects.toThrow(/could not be saved/);
    expect(update).not.toHaveBeenCalled();
  });
});
