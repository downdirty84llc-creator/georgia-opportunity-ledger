import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createServerSupabaseClient, checkRateLimit } = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/db/server', () => ({ createServerSupabaseClient }));
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://ledger.example/' },
}));
vi.mock('@/lib/http/rate-limit', () => ({
  checkRateLimit,
  rateLimitIdentity: () => 'ip:test',
}));

const { POST } = await import('@/app/api/v1/auth/login/route');
const providerFetch = vi.fn<typeof fetch>();

function signIn(email = 'member@example.test') {
  return POST(
    new Request('https://ledger.example/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'magic_link', email }),
    }),
    undefined as never,
  );
}

describe('magic-link sign-in is not registration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    checkRateLimit.mockResolvedValue({ allowed: true, resetAt: new Date() });
    providerFetch.mockImplementation(async () => Response.json({}));
    // Exercise the installed SDK and inspect its actual outgoing request.
    // Every provider request is intercepted: no email or account is created.
    createServerSupabaseClient.mockResolvedValue(
      createClient('https://supabase.example.test', 'test-anon-key', {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
          flowType: 'pkce',
        },
        global: { fetch: providerFetch },
      }),
    );
  });

  it('forbids account creation in the request sent to Supabase', async () => {
    const response = await signIn();

    expect(response.status).toBe(200);
    expect(providerFetch).toHaveBeenCalledTimes(1);
    const [input, init] = providerFetch.mock.calls[0] ?? [];
    const url = new URL(String(input));
    expect(url.pathname).toBe('/auth/v1/otp');
    expect(url.searchParams.get('redirect_to')).toBe(
      'https://ledger.example/auth/callback',
    );
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      email: 'member@example.test',
      create_user: false,
      code_challenge: expect.any(String),
      code_challenge_method: 's256',
    });
  });

  it('does not disclose whether an account exists', async () => {
    const existing = await signIn();
    providerFetch.mockResolvedValueOnce(
      Response.json(
        { code: 'otp_disabled', msg: 'Signups not allowed for otp' },
        { status: 422 },
      ),
    );
    const unknown = await signIn('unknown@example.test');

    expect(existing.status).toBe(200);
    expect(unknown.status).toBe(existing.status);
    expect(await unknown.json()).toEqual(await existing.json());
  });

  it('does not contact the provider after the rate limit is reached', async () => {
    checkRateLimit.mockResolvedValue({
      allowed: false,
      resetAt: new Date(Date.now() + 60_000),
    });

    const response = await signIn();

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it('rejects an invalid address before contacting the provider', async () => {
    const response = await signIn('not-an-email');

    expect(response.status).toBe(422);
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
