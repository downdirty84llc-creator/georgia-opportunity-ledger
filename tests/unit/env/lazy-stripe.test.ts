import { afterEach, describe, expect, it } from 'vitest';

import { serverEnv } from '@/lib/env';

/**
 * Stripe configuration is required at use, not at boot.
 *
 * Eleven modules call `serverEnv()`; three touch Stripe. Requiring the keys up
 * front meant an unconfigured payment provider took down everything that reads
 * any server variable — the job runner, which contains no Stripe reference,
 * returned 500 for that reason alone.
 *
 * The distinction these tests hold is narrow and easy to lose: **deferred is
 * not optional.** Reaching for a key that is not configured must still fail,
 * and fail with a message that names the variable. A refactor that turned
 * these into `?? ''` would pass a careless reading of "lazy" and hand Stripe an
 * empty secret key at runtime.
 */

const STRIPE_VARS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;

const saved = new Map<string, string | undefined>();

function unset(...names: string[]): void {
  for (const name of names) {
    if (!saved.has(name)) saved.set(name, process.env[name]);
    delete process.env[name];
  }
}

function set(name: string, value: string): void {
  if (!saved.has(name)) saved.set(name, process.env[name]);
  process.env[name] = value;
}

// The non-Stripe variables every call needs.
function configureNonStripe(): void {
  set('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  set('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  set('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
  set('CRON_SECRET', 'cron-secret');
}

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe('serverEnv() without Stripe configured', () => {
  it('returns, so unrelated code is not taken down with billing', () => {
    configureNonStripe();
    unset(...STRIPE_VARS);

    const env = serverEnv();
    expect(env.supabaseServiceRoleKey).toBe('service-key');
    expect(env.cronSecret).toBe('cron-secret');
  });

  it('still fails hard on a genuinely missing non-Stripe variable', () => {
    // The change is scoped to Stripe. Everything else keeps failing at boot,
    // because everything else is needed by everything.
    configureNonStripe();
    unset('SUPABASE_SERVICE_ROLE_KEY');

    expect(() => serverEnv()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});

describe('reaching for Stripe when it is not configured', () => {
  it.each(STRIPE_VARS)('throws naming %s', (name) => {
    configureNonStripe();
    unset(...STRIPE_VARS);

    const env = serverEnv();
    const read = () =>
      name === 'STRIPE_SECRET_KEY'
        ? env.stripeSecretKey
        : env.stripeWebhookSecret;

    // Deferred, not optional. An empty string here would be the dangerous
    // outcome: Stripe would be handed a blank credential at runtime.
    expect(read).toThrow(new RegExp(name));
  });
});

describe('reaching for Stripe when it is configured', () => {
  it('returns the values', () => {
    configureNonStripe();
    set('STRIPE_SECRET_KEY', 'sk_live_example');
    set('STRIPE_WEBHOOK_SECRET', 'whsec_example');

    const env = serverEnv();
    expect(env.stripeSecretKey).toBe('sk_live_example');
    expect(env.stripeWebhookSecret).toBe('whsec_example');
  });

  it('reads the variable each time rather than freezing it at call time', () => {
    // A getter that closed over the value at serverEnv() time would keep
    // serving a stale secret after a rotation.
    configureNonStripe();
    set('STRIPE_SECRET_KEY', 'sk_live_first');

    const env = serverEnv();
    expect(env.stripeSecretKey).toBe('sk_live_first');

    set('STRIPE_SECRET_KEY', 'sk_live_rotated');
    expect(env.stripeSecretKey).toBe('sk_live_rotated');
  });
});
