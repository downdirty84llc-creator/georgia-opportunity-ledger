import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getViewer, getSessionContext, rpc, from, reads, readFilters } =
  vi.hoisted(() => ({
    getViewer: vi.fn(),
    getSessionContext: vi.fn(),
    rpc: vi.fn(),
    from: vi.fn(),
    readFilters: vi.fn(),
    reads: new Map<string, { data: unknown; error: unknown }>(),
  }));
vi.mock('@/lib/auth/session', () => ({ getViewer, getSessionContext }));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({ from, rpc }),
}));
const { GET, PUT } = await import('@/app/api/v1/alert-preferences/route');
const { default: EmailPreferencesPage } =
  await import('@/app/(member)/account/email-preferences/page');
const body = {
  emailAlertsEnabled: false,
  marketingEmailEnabled: false,
  alertTypes: [{ alertType: 'weekly_report', enabled: false }],
};
const save = (value: unknown = body) =>
  PUT(
    new Request('https://ledger.example/api/v1/alert-preferences', {
      method: 'PUT',
      body: JSON.stringify(value),
    }),
    undefined as never,
  );
const read = () =>
  GET(
    new Request('https://ledger.example/api/v1/alert-preferences'),
    undefined as never,
  );

describe('customer email preference persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    reads.clear();
    getViewer.mockResolvedValue({ isAuthenticated: true, userId: 'member' });
    getSessionContext.mockResolvedValue({
      viewer: { userId: 'member', features: {} },
    });
    rpc.mockResolvedValue({ error: null });
    from.mockImplementation((table: string) => {
      const result = reads.get(table) ?? { data: null, error: null };
      const eq = vi.fn();
      const query = Object.assign(Promise.resolve(result), {
        maybeSingle: async () => result,
        eq,
      });
      eq.mockImplementation((key, value) => {
        readFilters(table, key, value);
        return query;
      });
      return {
        select: () => ({ eq }),
        update: () => ({ eq }),
        upsert: () => query,
      };
    });
  });

  it('saves the switches and alert choices in one session-bound transaction', async () => {
    expect((await save()).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('save_email_preferences', {
      p_email_alerts_enabled: false,
      p_marketing_email_enabled: false,
      p_alert_types: body.alertTypes,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('does not claim success or fall back to partial writes after a transaction failure', async () => {
    rpc.mockResolvedValue({ error: { message: 'fixture database failure' } });
    expect((await save()).status).toBe(500);
    expect(from).not.toHaveBeenCalled();
  });

  it.each(['user_preferences', 'alert_preferences'])(
    'reports a failed %s read instead of silently displaying enabled defaults',
    async (table) => {
      reads.set(table, {
        data: null,
        error: { message: 'fixture read failure' },
      });
      expect((await read()).status).toBe(500);
    },
  );

  it('rejects duplicate alert types before any write', async () => {
    expect(
      (
        await save({
          ...body,
          alertTypes: [...body.alertTypes, ...body.alertTypes],
        })
      ).status,
    ).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('keeps omitted frequency and score absent so the database can preserve existing values', async () => {
    await save();
    expect(rpc.mock.calls[0]?.[1].p_alert_types).toEqual([
      { alertType: 'weekly_report', enabled: false },
    ]);
  });

  it('can save master switches without changing any individual alert types', async () => {
    expect((await save({ ...body, alertTypes: [] })).status).toBe(200);
    expect(rpc.mock.calls[0]?.[1].p_alert_types).toEqual([]);
  });

  it('requires a signed-in session for both reads and writes', async () => {
    getViewer.mockResolvedValue({ isAuthenticated: false });
    expect((await read()).status).toBe(401);
    expect((await save()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it.each(['user_preferences', 'alert_preferences'])(
    'refuses to render guessed choices after a %s page read failure',
    async (table) => {
      reads.set(table, {
        data: null,
        error: { message: 'fixture page read failure' },
      });
      await expect(
        EmailPreferencesPage({ searchParams: Promise.resolve({}) }),
      ).rejects.toThrow('fixture page read failure');
    },
  );

  it('keeps in-app alert settings out of both the email page and API', async () => {
    expect((await read()).status).toBe(200);
    await EmailPreferencesPage({ searchParams: Promise.resolve({}) });
    expect(
      readFilters.mock.calls.filter(
        ([table, key, value]) =>
          table === 'alert_preferences' &&
          key === 'delivery_method' &&
          value === 'email',
      ),
    ).toHaveLength(2);
  });
});
