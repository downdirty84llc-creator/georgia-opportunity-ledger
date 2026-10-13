import { beforeEach, describe, expect, it, vi } from 'vitest';
import { featuresForRank } from '@/lib/access/ranks';
import { parseStoredFilters } from '@/lib/search/filters';
import type { EmailRecipient } from '@/lib/email/recipients';

const { from, recipients, enqueue, render, checkpoint } = vi.hoisted(() => ({
  from: vi.fn(),
  recipients: vi.fn(),
  enqueue: vi.fn(),
  render: vi.fn(),
  checkpoint: vi.fn(),
}));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({ from }) }));
vi.mock('@/lib/email/recipients', () => ({
  loadRecipientPage: recipients,
  queuedNotificationKeys: vi.fn(async () => new Set()),
}));
vi.mock('@/lib/email/outbox', () => ({ enqueueEmail: enqueue }));
vi.mock('@/lib/email/templates', () => ({
  weeklyReportEmail: render,
  premiumAlertEmail: render,
  deadlineReminderEmail: render,
}));
vi.mock('@/lib/email/unsubscribe', () => ({
  mintUnsubscribeToken: () => 'test-token',
}));
const { distributeWeeklyReportJob } = await import('@/lib/jobs/report-jobs');
const { durablePremiumAlertsJob } = await import('@/lib/jobs/email-alert-jobs');
const now = new Date('2026-10-13T14:00:00Z');

function member(id: string, rank = 0): EmailRecipient {
  return {
    userId: id,
    email: `${id}@example.test`,
    firstName: null,
    features: featuresForRank(rank),
    preferredCountyIds: [],
    accessRank: rank,
    accountStatus: 'active',
    emailAlertsEnabled: true,
    immediateAlertsEntitled: rank >= 30,
    minimumScore: 0,
    filters: parseStoredFilters({}),
    disabledAlertTypes: new Set(),
    deliveredKeys: new Set(),
  };
}
function query(data: unknown) {
  const q: Record<string, unknown> = {};
  for (const method of [
    'select',
    'in',
    'eq',
    'lte',
    'lt',
    'gte',
    'gt',
    'is',
    'order',
    'limit',
    'update',
  ])
    q[method] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => ({ data, error: null }));
  q.then = (resolve: (result: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(resolve);
  return q;
}
const source = {
  id: 'opp',
  title: 'Visible opportunity',
  slug: 'visible',
  summary: 'Public summary',
  score: 80,
  category: 'other',
  status: 'open',
  minimum_access_rank: 0,
  workflow_status: 'published',
  is_restricted: false,
  is_expired: false,
  published_at: '2026-10-12T00:00:00Z',
  counties: null,
};
const report = {
  id: 'report',
  title: 'Weekly',
  slug: 'weekly',
  published_at: source.published_at,
  minimum_access_rank: 10,
  executive_summary: 'Paid analysis must remain private',
  report_opportunities: [
    { display_order: 0, minimum_access_rank: 0, opportunities: source },
    {
      display_order: 1,
      minimum_access_rank: 0,
      opportunities: {
        ...source,
        id: 'restricted',
        title: 'Restricted source',
        is_restricted: true,
      },
    },
    {
      display_order: 2,
      minimum_access_rank: 0,
      opportunities: {
        ...source,
        id: 'premium',
        title: 'Premium source',
        minimum_access_rank: 30,
      },
    },
  ],
};

describe('resumable email producers', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    enqueue.mockResolvedValue('outbox');
    render.mockReturnValue({
      subject: 'Fixture',
      html: 'Fixture',
      text: 'Fixture',
    });
    checkpoint.mockResolvedValue(undefined);
    from.mockImplementation((table: string) =>
      query(table === 'reports' ? report : []),
    );
  });

  it('continues past a full page with no confirmed addresses and never emails paid summaries to free members', async () => {
    recipients
      .mockResolvedValueOnce({
        recipients: [],
        hasMore: true,
        nextAfter: 'raw-profile-25',
      })
      .mockResolvedValueOnce({
        recipients: [member('free'), member('weekly', 10)],
        hasMore: false,
        nextAfter: 'weekly',
      });
    const result = await distributeWeeklyReportJob.handler({
      now,
      note: vi.fn(),
      checkpoint,
    });
    expect(result.processed).toBe(2);
    expect(recipients.mock.calls[1]?.[1]).toMatchObject({
      after: 'raw-profile-25',
    });
    expect(render.mock.calls[0]?.[0]).toMatchObject({
      headline: expect.not.stringContaining('Paid analysis'),
      highlights: [expect.objectContaining({ id: 'opp' })],
    });
    expect(render.mock.calls[1]?.[0]).toMatchObject({
      headline: report.executive_summary,
      highlights: [expect.objectContaining({ id: 'opp' })],
    });
    expect(
      enqueue.mock.calls.map(([input]) => input.minimumAccessRank),
    ).toEqual([0, 10]);
    expect(checkpoint).toHaveBeenLastCalledWith({});
    const updates = from.mock.results.flatMap(
      ({ value }) => value.update.mock.calls,
    );
    expect(updates).toEqual([[{ email_queued_at: expect.any(String) }]]);
  });

  it('keeps the last successful recipient cursor when enqueue fails and resumes there', async () => {
    let state: Record<string, unknown> = {};
    checkpoint.mockImplementation(async (value) => {
      state = { ...value };
    });
    recipients.mockResolvedValueOnce({
      recipients: [member('one'), member('two')],
      hasMore: false,
      nextAfter: 'two',
    });
    enqueue
      .mockResolvedValueOnce('one-outbox')
      .mockRejectedValueOnce(new Error('database disconnected'));
    await expect(
      distributeWeeklyReportJob.handler({ now, note: vi.fn(), checkpoint }),
    ).rejects.toThrow('database disconnected');
    expect(state).toMatchObject({ reportId: 'report', recipientAfter: 'one' });
    recipients.mockResolvedValueOnce({
      recipients: [member('two')],
      hasMore: false,
      nextAfter: 'two',
    });
    await distributeWeeklyReportJob.handler({
      now,
      state,
      note: vi.fn(),
      checkpoint,
    });
    expect(recipients.mock.calls[1]?.[1]).toMatchObject({ after: 'one' });
    expect(enqueue.mock.calls.map(([input]) => input.userId)).toEqual([
      'one',
      'two',
      'two',
    ]);
  });

  it('honors report opt-outs and does not call a provider from the producer', async () => {
    const optedOut = member('opted-out');
    optedOut.disabledAlertTypes = new Set(['weekly_report']);
    recipients.mockResolvedValue({
      recipients: [optedOut],
      hasMore: false,
      nextAfter: optedOut.userId,
    });
    expect(
      (
        await distributeWeeklyReportJob.handler({
          now,
          note: vi.fn(),
          checkpoint,
        })
      ).processed,
    ).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('resumes a premium opportunity audience beyond its first recipient page', async () => {
    let calls = 0;
    from.mockImplementation((table: string) =>
      query(table === 'opportunities' && calls++ < 2 ? source : null),
    );
    recipients
      .mockResolvedValueOnce({
        recipients: [member('premium-one', 30)],
        hasMore: true,
        nextAfter: 'profile-25',
      })
      .mockResolvedValueOnce({
        recipients: [member('premium-two', 30)],
        hasMore: false,
        nextAfter: 'premium-two',
      });
    const result = await durablePremiumAlertsJob.handler({
      now,
      note: vi.fn(),
      checkpoint,
    });
    expect(result.processed).toBe(2);
    expect(recipients.mock.calls[1]?.[1]).toMatchObject({
      after: 'profile-25',
    });
    expect(checkpoint).toHaveBeenLastCalledWith({ since: now.toISOString() });
  });
  it('sends material-change emails with the audited version and respects the separate opt-out', async () => {
    let candidates = 0;
    from.mockImplementation((table: string) =>
      query(
        table === 'opportunities'
          ? candidates++ === 0
            ? { ...source, published_at: '2026-09-01T00:00:00Z' }
            : null
          : { version_number: 7, is_material_change: true },
      ),
    );
    const optedOut = member('disabled', 30);
    optedOut.disabledAlertTypes = new Set(['material_update']);
    recipients.mockResolvedValue({
      recipients: [member('premium', 30), member('free'), optedOut],
      hasMore: false,
      nextAfter: 'last',
    });
    await durablePremiumAlertsJob.handler({ now, note: vi.fn(), checkpoint });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      alertType: 'material_update',
      minimumAccessRank: 30,
      notifications: [
        expect.objectContaining({ dedupe_key: 'material_update:opp:v7' }),
      ],
    });
    expect(render.mock.calls[0]?.[0]).toMatchObject({ reason: 'updated' });
  });

  it('queues Premium briefings only for entitled members with briefing email enabled', async () => {
    from.mockImplementation((table: string) =>
      query(
        table === 'reports'
          ? {
              ...report,
              report_type: 'premium_briefing',
              minimum_access_rank: 30,
            }
          : [],
      ),
    );
    const optedOut = member('disabled', 30);
    optedOut.disabledAlertTypes = new Set(['premium_briefing']);
    recipients.mockResolvedValue({
      recipients: [
        member('free'),
        member('weekly', 10),
        member('premium', 30),
        optedOut,
      ],
      hasMore: false,
      nextAfter: 'last',
    });
    await distributeWeeklyReportJob.handler({ now, note: vi.fn(), checkpoint });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      userId: 'premium',
      alertType: 'premium_briefing',
      minimumAccessRank: 30,
    });
  });
});
