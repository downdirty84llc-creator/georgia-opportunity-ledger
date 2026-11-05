import { beforeEach, describe, expect, it, vi } from 'vitest';
const { resolve, from, updates } = vi.hoisted(() => ({
  resolve: vi.fn(),
  from: vi.fn(),
  updates: vi.fn(),
}));
vi.mock('@/lib/email/unsubscribe-registry', () => ({
  resolveUnsubscribeToken: resolve,
}));
vi.mock('@/lib/db/admin', () => ({ createAdminClient: () => ({ from }) }));
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://ledger.example' },
}));
const { POST, GET } = await import('@/app/api/v1/unsubscribe/route');
beforeEach(() => {
  resolve.mockReset().mockResolvedValue({ userId: 'member-id', scope: 'all' });
  updates.mockReset().mockResolvedValue({ error: null });
  from.mockReset().mockImplementation(() => ({
    update: (value: object) => ({
      eq: (_: string, id: string) => updates(value, id),
    }),
  }));
});
describe('signed-out unsubscribe route', () => {
  it('applies recovered tokens without a login and disables every requested preference', async () => {
    const response = await POST(
      new Request('https://ledger.example/api/v1/unsubscribe?token=old', {
        method: 'POST',
      }),
    );
    expect(response.status).toBe(200);
    expect(updates.mock.calls).toEqual([
      [
        { email_alerts_enabled: false, marketing_email_enabled: false },
        'member-id',
      ],
      [{ enabled: false }, 'member-id'],
    ]);
  });
  it('redirects a valid footer link after saving the preferences', async () => {
    const response = await GET(
      new Request('https://ledger.example/api/v1/unsubscribe?token=old'),
    );
    expect(response.headers.get('location')).toBe(
      'https://ledger.example/unsubscribed?status=ok',
    );
  });
  it('rejects invalid tokens without writing preferences', async () => {
    resolve.mockResolvedValue(null);
    expect(
      (
        await POST(
          new Request(
            'https://ledger.example/api/v1/unsubscribe?token=forged',
            { method: 'POST' },
          ),
        )
      ).status,
    ).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
  it('returns a retryable error when recovery storage or preference writes fail', async () => {
    resolve.mockRejectedValueOnce(new Error('storage unavailable'));
    expect(
      (
        await POST(
          new Request('https://ledger.example/api/v1/unsubscribe?token=old', {
            method: 'POST',
          }),
        )
      ).status,
    ).toBe(503);
    updates
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'offline' } });
    const response = await GET(
      new Request('https://ledger.example/api/v1/unsubscribe?token=old'),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('Retry-After')).toBe('30');
  });
});
