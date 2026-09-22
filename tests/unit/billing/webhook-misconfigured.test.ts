import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * An unconfigured Stripe must not look like a bad request.
 *
 * `stripe()` and `stripeWebhookSecret` both throw when their environment
 * variable is missing, and both used to throw inside the signature-verification
 * try. So a missing `STRIPE_SECRET_KEY` was logged as "signature verification
 * failed" and answered **400** — a configuration fault wearing the costume of a
 * caller error, which is how it survived unnoticed in production while every
 * delivery was rejected.
 *
 * The status is the part that costs money. Stripe treats 4xx as permanent and
 * does not retry, so each event arriving while the key was missing was
 * discarded rather than deferred. A 500 is retried, and the backlog lands once
 * the configuration is fixed.
 */

let stripeThrows = false;
let webhookSecretThrows = false;
const constructEvent = vi.fn();

vi.mock('@/lib/billing/stripe', () => ({
  stripe: () => {
    if (stripeThrows) {
      throw new Error(
        'Missing required environment variable STRIPE_SECRET_KEY. ' +
          'See .env.example for the full list.',
      );
    }
    return { webhooks: { constructEvent } };
  },
  toDate: () => null,
}));

vi.mock('@/lib/env', () => ({
  serverEnv: () => ({
    get stripeWebhookSecret() {
      if (webhookSecretThrows) {
        throw new Error(
          'Missing required environment variable STRIPE_WEBHOOK_SECRET.',
        );
      }
      return 'whsec_fake';
    },
  }),
}));

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/lib/analytics/events', () => ({ track: () => Promise.resolve() }));
vi.mock('@/lib/billing/plans', () => ({
  planForPriceId: () => Promise.resolve(null),
}));

const { POST } = await import('@/app/api/v1/webhooks/stripe/route');

function deliver(headers: Record<string, string>): Promise<Response> {
  return POST(
    new Request('https://example.test/api/v1/webhooks/stripe', {
      method: 'POST',
      headers,
      body: '{}',
    }),
  ) as unknown as Promise<Response>;
}

describe('the webhook when Stripe is not configured', () => {
  beforeEach(() => {
    stripeThrows = false;
    webhookSecretThrows = false;
    constructEvent.mockReset();
    constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'some.unhandled.event',
      data: { object: {} },
    });
  });

  it('answers 500, not 400, when STRIPE_SECRET_KEY is missing', async () => {
    stripeThrows = true;

    const response = await deliver({ 'stripe-signature': 'sig' });
    const body = (await response.json()) as { error?: { message?: string } };

    // 400 would tell Stripe never to retry, losing the event permanently.
    expect(response.status).toBe(500);
    expect(body.error?.message).toMatch(/not configured/i);
  });

  it('answers 500 when STRIPE_WEBHOOK_SECRET is missing', async () => {
    webhookSecretThrows = true;

    const response = await deliver({ 'stripe-signature': 'sig' });

    expect(response.status).toBe(500);
  });

  it('does not blame the signature for a configuration fault', async () => {
    // The misdiagnosis that hid this: an unset variable reported as a bad
    // signature sends whoever reads the log hunting the wrong bug entirely.
    stripeThrows = true;

    const body = JSON.stringify(
      await (await deliver({ 'stripe-signature': 'sig' })).json(),
    );

    expect(body).not.toMatch(/signature/i);
  });

  it('never reveals which variable is missing to the caller', async () => {
    // The variable name belongs in our log, not in an unauthenticated response.
    stripeThrows = true;

    const body = JSON.stringify(
      await (await deliver({ 'stripe-signature': 'sig' })).json(),
    );

    expect(body).not.toContain('STRIPE_SECRET_KEY');
  });

  it('still answers 400 for a genuinely bad signature when configured', async () => {
    constructEvent.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    const response = await deliver({ 'stripe-signature': 'sig' });
    const body = (await response.json()) as { error?: { message?: string } };

    expect(response.status).toBe(400);
    expect(body.error?.message).toMatch(/invalid signature/i);
  });

  it('still answers 400 when the signature header is absent', async () => {
    const response = await deliver({});

    expect(response.status).toBe(400);
  });
});
