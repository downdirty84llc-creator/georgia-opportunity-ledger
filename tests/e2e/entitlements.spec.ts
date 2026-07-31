import { expect, test, type Page } from '@playwright/test';

/**
 * Access-rank enforcement, tier by tier (specification 26).
 *
 * These are the checks that need real accounts, so they run against a database
 * loaded with `npm run db:seed`. When that seed is absent they **skip loudly**
 * rather than pass: a green tick for a test that never signed anyone in is
 * worse than no test, because it is the access boundary it claims to cover.
 *
 * What is being defended here is specific. A member paying for one tier must
 * not be able to reach the next one by asking the API directly, by guessing a
 * URL, or by changing a number in a request body. Every one of those has a
 * server-side answer; these confirm it is actually wired up.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'ledger-demo-password-2026';

const ACCOUNTS = {
  free: 'free.member@example.com',
  weekly: 'weekly.member@example.com',
  detailed: 'detailed.member@example.com',
  premium: 'premium.member@example.com',
  researcher: 'researcher@example.com',
} as const;

type Tier = keyof typeof ACCOUNTS;

async function signIn(page: Page, email: string): Promise<boolean> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 15_000,
    })
    .catch(() => undefined);

  return !new URL(page.url()).pathname.startsWith('/login');
}

async function requireSeed(page: Page, tier: Tier): Promise<void> {
  const ok = await signIn(page, ACCOUNTS[tier]);
  test.skip(
    !ok,
    `No seeded ${tier} account. Run \`npm run db:seed\` against the test ` +
      `database, or set SEED_PASSWORD, before trusting this suite.`,
  );
}

test.describe('tier boundaries', () => {
  test('a free member is told what is locked and which plan unlocks it', async ({
    page,
  }) => {
    await requireSeed(page, 'free');
    await page.goto('/opportunities');

    // Spec 14.3: never a blurred teaser with no explanation.
    const locked = page.getByText(/upgrade|included in|plan/i).first();
    await expect(locked).toBeVisible();
  });

  test('CSV export is refused below Detailed', async ({ page }) => {
    await requireSeed(page, 'weekly');

    const response = await page.request.post('/api/v1/exports/opportunities', {
      data: { filters: {} },
      failOnStatusCode: false,
    });

    // 402 is the honest status for "your plan does not include this".
    expect([402, 403]).toContain(response.status());

    const body = await response.json();
    expect(
      body.error?.details?.requiredPlan ?? body.error?.message,
      'the refusal must name the plan that would unlock it',
    ).toBeTruthy();
  });

  test('saved searches are refused below Premium', async ({ page }) => {
    await requireSeed(page, 'detailed');

    const response = await page.request.post('/api/v1/saved-searches', {
      data: { name: 'Boundary probe', filters: {}, alertsEnabled: true },
      failOnStatusCode: false,
    });
    expect([402, 403, 422]).toContain(response.status());
  });

  test('a member cannot raise their own access rank', async ({ page }) => {
    await requireSeed(page, 'free');

    // The obvious attack: send the rank you want and hope the server trusts it.
    const response = await page.request.patch('/api/v1/preferences', {
      data: {
        minimumScore: 0,
        accessRank: 30,
        access_rank_override: 100,
        role: 'super_administrator',
      },
      failOnStatusCode: false,
    });

    // Whether it validates or ignores the extra fields, the session must not
    // come back elevated.
    void response;
    const session = await page.request.get('/api/v1/auth/session');
    const body = await session.json();
    expect(body.data?.accessRank ?? 0).toBeLessThan(30);
    expect(body.data?.role).not.toBe('super_administrator');
    expect(body.data?.isStaff).not.toBe(true);
  });

  test('a paying member still has no administrative access', async ({
    page,
  }) => {
    await requireSeed(page, 'premium');

    // Rank and role are separate axes. Premium is rank 30 and role 'member'.
    for (const path of ['/api/v1/admin/opportunities', '/api/v1/admin/staff']) {
      const response = await page.request.get(path, {
        failOnStatusCode: false,
      });
      expect([401, 403, 404], `${path}`).toContain(response.status());
    }

    await page.goto('/admin');
    expect(new URL(page.url()).pathname).not.toBe('/admin');
  });

  test('a researcher cannot reset anyone’s two-factor', async ({ page }) => {
    await requireSeed(page, 'researcher');

    const response = await page.request.post(
      '/api/v1/admin/staff/00000000-0000-0000-0000-000000000000/reset-mfa',
      {
        data: { reason: 'Probing the boundary from a non-super-admin role.' },
        failOnStatusCode: false,
      },
    );
    expect([401, 403, 404]).toContain(response.status());
  });
});

test.describe('session hygiene', () => {
  test('signing out ends access immediately', async ({ page }) => {
    await requireSeed(page, 'weekly');

    await page.request.post('/api/v1/auth/logout');

    const session = await page.request.get('/api/v1/auth/session');
    const body = await session.json();
    expect(body.data?.authenticated).toBe(false);

    const saved = await page.request.get('/api/v1/saved-opportunities', {
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(saved.status());
  });
});
