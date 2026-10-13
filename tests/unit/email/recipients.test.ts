import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, addresses } = vi.hoisted(() => ({
  from: vi.fn(),
  addresses: vi.fn(),
}));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({ from }) }));
vi.mock('@/lib/email/outbox', () => ({ memberEmailAddresses: addresses }));
const { loadRecipientPage } = await import('@/lib/email/recipients');
const now = new Date('2026-10-13T12:00:00Z');
const profile = (id: string) => ({
  id,
  role: 'member',
  account_status: 'active',
  first_name: null,
  access_rank_override: null,
  access_rank_override_expires_at: null,
  subscriptions: null,
  user_preferences: null,
  alert_preferences: [],
});

function dataset(rows: unknown[]) {
  from.mockImplementation(() => {
    let after = '';
    let limit = Infinity;
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      lte: () => q,
      gt: (_column: string, id: string) => {
        after = id;
        return q;
      },
      limit: (n: number) => {
        limit = n;
        return q;
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({
          data: rows
            .filter((row) => (row as { id: string }).id > after)
            .slice(0, limit),
          error: null,
        }).then(resolve),
    };
    return q;
  });
}

describe('recipient pagination and current entitlements', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    addresses.mockImplementation(
      async (ids: string[]) =>
        new Map(ids.map((id) => [id, `${id}@example.test`])),
    );
  });
  it('reaches members beyond 1,000 and advances through pages without confirmed emails', async () => {
    dataset(
      Array.from({ length: 1003 }, (_, i) =>
        profile(String(i).padStart(5, '0')),
      ),
    );
    addresses.mockResolvedValueOnce(new Map());
    const ids: string[] = [];
    let after: string | undefined;
    let pages = 0;
    do {
      const page = await loadRecipientPage(now, { after });
      ids.push(...page.recipients.map((r) => r.userId));
      pages++;
      if (!page.hasMore) break;
      after = page.nextAfter!;
    } while (pages < 50);
    expect(pages).toBe(41);
    expect(ids).toHaveLength(978);
    expect(ids.at(-1)).toBe('01002');
    expect(new Set(ids).size).toBe(ids.length);
    expect(addresses.mock.calls.every(([batch]) => batch.length <= 25)).toBe(
      true,
    );
  });

  it('does not inherit Premium features from an unpaid or expired subscription', async () => {
    dataset([
      {
        ...profile('unpaid'),
        subscriptions: {
          status: 'active',
          stripe_subscription_id: 'sub-test',
          paid_through_at: null,
          current_period_end: '2026-11-01T00:00:00Z',
          subscription_plans: {
            code: 'premium',
            access_rank: 30,
            feature_configuration: { immediateAlerts: true },
          },
        },
      },
    ]);
    const member = (await loadRecipientPage(now)).recipients[0]!;
    expect(member.accessRank).toBe(0);
    expect(member.immediateAlertsEntitled).toBe(false);
  });

  it('honors never-frequency email preferences while retaining staff entitlements', async () => {
    dataset([
      {
        ...profile('staff'),
        role: 'super_administrator',
        alert_preferences: [
          {
            alert_type: 'weekly_report',
            enabled: true,
            frequency: 'never',
            delivery_method: 'email',
          },
        ],
      },
    ]);
    const member = (await loadRecipientPage(now)).recipients[0]!;
    expect(member.accessRank).toBe(100);
    expect(member.immediateAlertsEntitled).toBe(true);
    expect(member.disabledAlertTypes.has('weekly_report')).toBe(true);
  });
});
