import { expect, test } from '@playwright/test';

import {
  skipIfEnvironmentIsDown,
  skipWithoutDatabase,
} from './support/environment';

/**
 * Public-page smoke tests (spec 26).
 *
 * These run against a built app with a migrated database behind it
 * (`E2E_BASE_URL` or the config's webServer). They assert the things that must
 * hold with or without content: pages render, navigation works, no protected
 * content leaks to a signed-out visitor, and the access boundary redirects.
 */

test.describe('public pages', () => {
  test('home page renders with navigation and disclaimer', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Georgia Opportunity Ledger/);
    await expect(
      page.getByRole('navigation', { name: 'Primary' }),
    ).toBeVisible();
    await expect(
      page.getByText(/not a real-estate brokerage/i).first(),
    ).toBeVisible();
  });

  test('pricing page shows all four tiers and the comparison table', async ({
    page,
    request,
  }) => {
    await skipWithoutDatabase(request);
    await page.goto('/pricing');
    await expect(
      page.getByRole('heading', { name: 'Membership plans' }),
    ).toBeVisible();
    for (const plan of [
      'Free Preview',
      'Weekly Report',
      'Detailed Intelligence',
      'Premium Alerts and Database',
    ]) {
      await expect(page.getByRole('heading', { name: plan })).toBeVisible();
    }
    await expect(page.getByRole('table')).toBeVisible();
  });

  test('how-it-works publishes the scoring method', async ({ page }) => {
    await page.goto('/how-it-works');
    await expect(page.getByText('Source reliability')).toBeVisible();
    await expect(page.getByText('85–100')).toBeVisible();
  });

  test('legal pages render', async ({ page }) => {
    await page.goto('/legal/terms');
    await expect(
      page.getByRole('heading', { name: 'Terms of Service' }),
    ).toBeVisible();
    await page.goto('/legal/disclaimers');
    await expect(
      page.getByText(/not a licensed real-estate broker/i),
    ).toBeVisible();
  });

  test('a signed-out visitor is redirected away from the member area', async ({
    page,
  }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('a signed-out visitor is redirected away from the admin area', async ({
    page,
  }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the opportunities API refuses oversized page requests gracefully', async ({
    request,
  }) => {
    const response = await request.get('/api/v1/opportunities?limit=100', {
      failOnStatusCode: false,
    });
    skipIfEnvironmentIsDown(response.status(), '/api/v1/opportunities');
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    // A signed-out caller is capped at the free page size even when asking
    // for the Premium maximum.
    expect(payload.data.length).toBeLessThanOrEqual(20);
  });

  test('unknown records 404 without leaking existence detail', async ({
    request,
  }) => {
    const response = await request.get(
      '/api/v1/opportunities/00000000-0000-4000-8000-000000000000',
      { failOnStatusCode: false },
    );
    skipIfEnvironmentIsDown(response.status(), '/api/v1/opportunities/{id}');
    expect(response.status()).toBe(404);
  });
});
