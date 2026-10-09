import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { env, publicEnv } = vi.hoisted(() => ({
  env: {
    emailProvider: 'resend',
    emailApiKey: '',
    emailFrom: 'sender@example.test',
    emailReplyTo: '',
  },
  publicEnv: { environment: 'production', siteUrl: 'https://ledger.example' },
}));
vi.mock('@/lib/env', () => ({ publicEnv, serverEnv: () => env }));
const { sendEmail } = await import('@/lib/email/client');
const message = {
  to: 'member@example.test',
  subject: 'Account notice',
  html: '<p>Notice</p>',
  text: 'Notice',
};

describe('email delivery configuration', () => {
  beforeEach(() => {
    env.emailProvider = 'resend';
    env.emailApiKey = '';
    publicEnv.environment = 'production';
    vi.stubGlobal('fetch', vi.fn());
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['resend', 'postmark'])(
    'does not record a delivery when %s has no API key',
    async (provider) => {
      env.emailProvider = provider;
      const result = await sendEmail(message);
      expect(result.ok).toBe(false);
      expect(result.providerMessageId).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
    },
  );

  it('refuses the console provider in production', async () => {
    env.emailProvider = 'console';
    expect((await sendEmail(message)).ok).toBe(false);
    expect(console.info).not.toHaveBeenCalled();
  });

  it('retains deliberate console previews outside production', async () => {
    env.emailProvider = 'console';
    publicEnv.environment = 'development';
    expect(await sendEmail(message)).toMatchObject({
      ok: true,
      providerMessageId: expect.stringMatching(/^console-/),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends through a configured provider', async () => {
    env.emailApiKey = 'test-only-key';
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ id: 'provider-message-1' }), {
        status: 200,
      }),
    );
    expect(await sendEmail(message)).toEqual({
      ok: true,
      providerMessageId: 'provider-message-1',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
