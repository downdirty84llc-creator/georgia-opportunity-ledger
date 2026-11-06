import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({ rpc }) }));
const { generateWeeklyDigestJob, digestPeriodKey } =
  await import('@/lib/jobs/weekly-digest');

describe('weekly digest retry boundaries', () => {
  beforeEach(() => vi.resetAllMocks());
  it('uses a completed Thursday-Wednesday period across weekdays and year rollover', () => {
    expect(digestPeriodKey(new Date('2026-11-04T23:59:59Z'))).toBe(
      '2026-10-28',
    );
    for (const date of [
      '2026-11-05',
      '2026-11-06',
      '2026-11-09',
      '2026-11-11',
    ]) {
      expect(digestPeriodKey(new Date(date + 'T14:00:00Z'))).toBe('2026-11-04');
    }
    expect(digestPeriodKey(new Date('2026-11-12T14:00:00Z'))).toBe(
      '2026-11-11',
    );
    expect(digestPeriodKey(new Date('2026-01-01T14:00:00Z'))).toBe(
      '2025-12-31',
    );
  });
  it('treats absent verified content and failed publication as failures for retries and alerts', async () => {
    for (const response of [
      { error: { message: 'database unavailable' }, data: null },
      {
        error: null,
        data: { created: false, reason: 'no_current_verified_content' },
      },
      { error: null, data: null },
    ]) {
      rpc.mockResolvedValue(response);
      await expect(
        generateWeeklyDigestJob.handler({ now: new Date(), note: vi.fn() }),
      ).rejects.toThrow();
    }
  });
  it('records atomic publication and preserves an existing editorial report', async () => {
    rpc.mockResolvedValue({
      error: null,
      data: { created: true, id: 'report', slug: 'digest', opportunities: 2 },
    });
    await expect(
      generateWeeklyDigestJob.handler({ now: new Date(), note: vi.fn() }),
    ).resolves.toMatchObject({ processed: 1, failed: 0, skipped: false });
    expect(rpc).toHaveBeenCalledWith('publish_automated_weekly_digest', {
      p_preview: false,
    });
    rpc.mockResolvedValue({
      error: null,
      data: {
        created: false,
        reason: 'existing_weekly_report',
        id: 'editorial',
        slug: 'manual',
      },
    });
    await expect(
      generateWeeklyDigestJob.handler({ now: new Date(), note: vi.fn() }),
    ).resolves.toMatchObject({
      processed: 0,
      failed: 0,
      skipped: true,
      detail: { reportId: 'editorial' },
    });
  });
});
