import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env, publicEnv } = vi.hoisted(() => ({
  env: {
    emailProvider: 'resend',
    emailApiKey: 'test-key',
    emailFrom: 'sender@example.test',
    emailReplyTo: 'support@example.test',
  },
  publicEnv: { environment: 'production', siteUrl: 'https://ledger.example' },
}));
vi.mock('@/lib/env', () => ({ publicEnv, serverEnv: () => env }));
const { prepareEmail, deliveryCredentials, sendPreparedEmail } =
  await import('@/lib/email/durable-client');
const message = {
  to: 'member@example.test',
  subject: 'Notice',
  html: '<p>Notice</p>',
  text: 'Notice',
  unsubscribeToken: 'test-token',
};

describe('durable provider requests', () => {
  beforeEach(() => {
    Object.assign(env, {
      emailProvider: 'resend',
      emailApiKey: 'test-key',
      emailFrom: 'sender@example.test',
      emailReplyTo: 'support@example.test',
    });
    publicEnv.environment = 'production';
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('retries exactly the persisted payload and key after an uncertain response', async () => {
    const prepared = JSON.parse(JSON.stringify(prepareEmail(message)));
    env.emailFrom = 'changed@example.test';
    env.emailReplyTo = 'changed-support@example.test';
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(Response.json({ id: 'confirmed' }));
    expect(
      await sendPreparedEmail(prepared, 'ledger-email/fixed'),
    ).toMatchObject({ ok: false, needsReview: false });
    expect(
      await sendPreparedEmail(prepared, 'ledger-email/fixed'),
    ).toMatchObject({ ok: true, providerMessageId: 'confirmed' });
    for (const call of vi.mocked(fetch).mock.calls) {
      expect(call[1]).toMatchObject({
        redirect: 'error',
        body: JSON.stringify(prepared.body),
        headers: { 'Idempotency-Key': 'ledger-email/fixed' },
      });
      expect(JSON.parse(call[1]!.body as string)).toMatchObject({
        from: 'sender@example.test',
        reply_to: 'support@example.test',
      });
      expect(call[1]!.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it.each([
    [200, {}, false],
    [429, {}, false],
    [503, {}, false],
    [409, { name: 'concurrent_idempotent_requests' }, false],
    [409, { name: 'invalid_idempotent_request' }, true],
    [422, {}, true],
  ])(
    'classifies HTTP %s without claiming a delivery',
    async (status, body, review) => {
      vi.mocked(fetch).mockResolvedValue(Response.json(body, { status }));
      expect(
        await sendPreparedEmail(prepareEmail(message), 'fixed'),
      ).toMatchObject({
        ok: false,
        providerMessageId: null,
        needsReview: review,
      });
    },
  );

  it('requires reconciliation after an uncertain Postmark send', async () => {
    env.emailProvider = 'postmark';
    vi.mocked(fetch).mockRejectedValue(new Error('timeout'));
    expect(
      await sendPreparedEmail(prepareEmail(message), 'fixed'),
    ).toMatchObject({ ok: false, needsReview: true });
  });

  it('refuses missing credentials, production console and provider changes before sending', async () => {
    const prepared = prepareEmail(message);
    env.emailApiKey = '';
    expect(() => deliveryCredentials()).toThrow('missing');
    env.emailProvider = 'console';
    expect(() => deliveryCredentials()).toThrow('Production');
    expect(await sendPreparedEmail(prepared, 'fixed')).toMatchObject({
      ok: false,
      needsReview: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stores only a stable credential fingerprint for detecting account changes', () => {
    const first = deliveryCredentials();
    expect(first).toEqual(deliveryCredentials());
    expect(first.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    env.emailApiKey = 'different-test-key';
    expect(deliveryCredentials().fingerprint).not.toBe(first.fingerprint);
  });
});
