import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Registration collected terms acceptance and then did not record it.
 *
 * The route updated `profiles` with the **request-scoped** client. Email
 * confirmation is required, so `signUp` returns no session; `auth.uid()` is
 * null, the `profiles_update_own` policy (`id = auth.uid()`) matches no row,
 * and the update wrote nothing. No error was raised that anybody read, so the
 * only evidence was `terms_accepted_at` sitting null in the database — found by
 * running the signup flow against production, not by reading the code.
 *
 * `track('account_created')` in the same block worked throughout, because it
 * already used the admin client. That is why the test below asserts *which*
 * client performed the write: a test that only checked the payload would pass
 * against the broken version, exactly as the original one would have.
 */

const adminUpdate = vi.fn();
const adminEq = vi.fn();
const requestUpdate = vi.fn();
const requestEq = vi.fn();

const signUp = vi.fn();

/** Set by a test to make the privileged write fail. */
let adminWriteError: { message: string } | null = null;

vi.mock('@/lib/db/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      update: (payload: unknown) => {
        adminUpdate(payload);
        return {
          eq: (_col: string, id: string) => {
            adminEq(id);
            return Promise.resolve({ error: adminWriteError });
          },
        };
      },
    }),
  }),
}));

vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({
      auth: { signUp },
      from: () => ({
        update: (payload: unknown) => {
          requestUpdate(payload);
          return {
            eq: (_col: string, id: string) => {
              requestEq(id);
              return Promise.resolve({ error: null });
            },
          };
        },
      }),
    }),
}));

vi.mock('@/lib/analytics/events', () => ({ track: () => Promise.resolve() }));
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://georgiaopportunityledger.com' },
}));
vi.mock('@/lib/http/rate-limit', () => ({
  checkRateLimit: () =>
    Promise.resolve({
      allowed: true,
      remaining: 4,
      resetAt: new Date(),
      limit: 5,
    }),
  rateLimitIdentity: () => 'ip:test',
}));

const { POST } = await import('@/app/api/v1/auth/register/route');

function register(): Promise<Response> {
  // `withErrorHandling` passes a route context through; this route ignores it.
  return POST(
    new Request('https://georgiaopportunityledger.com/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'someone@example.test',
        password: 'a-sufficiently-long-password',
        companyName: 'Example Holdings',
        acceptedTerms: true,
      }),
    }),
    undefined as never,
  ) as unknown as Promise<Response>;
}

describe('registration recording terms acceptance', () => {
  beforeEach(() => {
    adminUpdate.mockReset();
    adminEq.mockReset();
    requestUpdate.mockReset();
    requestEq.mockReset();
    signUp.mockReset();
    adminWriteError = null;
    // The real shape when confirmation is required: a user, and no session.
    signUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: null },
      error: null,
    });
  });

  it('writes the profile with the privileged client, not the request client', async () => {
    // The whole defect. Without a session the request client is scoped by RLS
    // to `auth.uid()`, which is null here, so its update matches no rows.
    await register();

    expect(adminUpdate).toHaveBeenCalledTimes(1);
    expect(requestUpdate).not.toHaveBeenCalled();
  });

  it('records both acceptances and the company name', async () => {
    await register();

    const payload = adminUpdate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.terms_accepted_at).toEqual(expect.any(String));
    expect(payload.privacy_accepted_at).toEqual(expect.any(String));
    expect(payload.company_name).toBe('Example Holdings');
  });

  it('scopes the write to the new user id', async () => {
    // A service-role write with no `eq` would rewrite every profile in the
    // table, which is the risk that comes with using the privileged client.
    await register();

    expect(adminEq).toHaveBeenCalledWith('user-1');
  });

  it('still answers 201 when the profile write fails', async () => {
    // The account exists and the address needs confirming either way. Failing
    // the request would lose the member over an incomplete profile — but the
    // failure must reach the log, which is the half that was missing before.
    adminWriteError = { message: 'permission denied for table profiles' };
    const errors: unknown[][] = [];
    const spy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });

    const response = await register();

    expect(response.status).toBe(201);
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0])).toContain('permission denied');

    spy.mockRestore();
  });

  it('does not touch the profile when sign-up returned no user', async () => {
    signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'User already registered' },
    });

    const response = await register();

    // Answers 201 regardless, so the endpoint cannot be used to discover which
    // addresses are registered.
    expect(response.status).toBe(201);
    expect(adminUpdate).not.toHaveBeenCalled();
  });
});
