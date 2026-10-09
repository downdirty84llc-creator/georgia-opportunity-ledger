import { beforeEach, describe, expect, it, vi } from 'vitest';

const { exchangeCodeForSession } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));
vi.mock('@/lib/db/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: { exchangeCodeForSession },
  }),
}));
vi.mock('@/lib/env', () => ({
  publicEnv: { siteUrl: 'https://ledger.example' },
}));
const { GET } = await import('@/app/auth/callback/route');

describe('recovery callback destinations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  });

  it('exchanges the recovery code before opening the password form', async () => {
    const response = await GET(
      new Request(
        'https://ledger.example/auth/callback?code=recovery-code&next=%2Fauth%2Freset-password',
      ),
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith('recovery-code');
    expect(response.headers.get('location')).toBe(
      'https://ledger.example/auth/reset-password',
    );
  });

  it('returns a failed recovery exchange to the reset form with a fixed notice', async () => {
    exchangeCodeForSession.mockResolvedValue({
      error: { message: 'missing verifier' },
    });
    const response = await GET(
      new Request(
        'https://ledger.example/auth/callback?code=recovery-code&next=%2Fauth%2Freset-password',
      ),
    );
    expect(response.headers.get('location')).toBe(
      'https://ledger.example/auth/reset-password?notice=signin_required',
    );
  });

  it('keeps a refused recovery link on the recovery path', async () => {
    const response = await GET(
      new Request(
        'https://ledger.example/auth/callback?error=access_denied&next=%2Fauth%2Freset-password',
      ),
    );
    expect(response.headers.get('location')).toBe(
      'https://ledger.example/auth/reset-password?notice=link_error',
    );
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('preserves the recovery destination when only the browser can read an error fragment', async () => {
    const response = await GET(
      new Request(
        'https://ledger.example/auth/callback?next=%2Fauth%2Freset-password',
      ),
    );
    expect(response.headers.get('location')).toBe(
      'https://ledger.example/auth/reset-password',
    );
  });
});
