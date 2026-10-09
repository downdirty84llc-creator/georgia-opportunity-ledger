import { expect, test } from '@playwright/test';

// Browser/API-boundary regression tests. No real account is created and no
// password or email is sent to Supabase. The session is visible only to the
// server, matching the app's HttpOnly cookie contract.
test('an HttpOnly session can reach the password-change form and API', async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([
    {
      name: 'recovery-fixture',
      value: 'server-only',
      url: baseURL!,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: { data: { authenticated: true } } }),
  );
  let updateBody: unknown;
  await page.route('**/api/v1/auth/password-reset', async (route) => {
    expect(route.request().method()).toBe('PUT');
    updateBody = route.request().postDataJSON();
    await route.fulfill({
      status: 400,
      json: { error: { message: 'Choose a different password.' } },
    });
  });
  await page.goto('/auth/reset-password');
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    'recovery-fixture',
  );
  await expect(
    page.getByRole('heading', { name: 'Choose a new password' }),
  ).toBeVisible();
  await page
    .getByLabel('New password', { exact: true })
    .fill('a-new-long-password');
  await page.getByLabel('Confirm new password').fill('a-new-long-password');
  await page.getByRole('button', { name: 'Change my password' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Choose a different password.',
  );
  expect(updateBody).toEqual({ password: 'a-new-long-password' });
});

test('a failed reset request is not reported as an email on its way', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: { data: { authenticated: false } } }),
  );
  await page.route('**/api/v1/auth/password-reset', (route) =>
    route.fulfill({
      status: 500,
      json: { error: { message: 'Reset service unavailable.' } },
    }),
  );
  await page.goto('/auth/reset-password');
  await page.getByLabel('Email address').fill('member@example.test');
  await page.getByRole('button', { name: 'Email me a reset link' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Reset service unavailable.',
  );
  await expect(
    page.getByText(/a password reset link is on its way/),
  ).toHaveCount(0);
});

test('refused links show a safe recovery message without reflecting URL text', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: { data: { authenticated: false } } }),
  );
  await page.goto(
    '/auth/reset-password#error=access_denied&error_description=UNTRUSTED_TEXT',
  );
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'reset link could not be used',
  );
  await expect(page.getByText('UNTRUSTED_TEXT')).toHaveCount(0);
});

test('already-issued recovery URLs forward their code to the server callback', async ({
  request,
  baseURL,
}) => {
  const response = await request.get(
    '/auth/reset-password?code=legacy-recovery-code',
    {
      maxRedirects: 0,
    },
  );
  expect(response.status()).toBe(307);
  const location = response.headers().location;
  expect(location).toBeTruthy();
  const destination = new URL(location!, baseURL);
  expect(destination.pathname).toBe('/auth/callback');
  expect(destination.searchParams.get('code')).toBe('legacy-recovery-code');
  expect(destination.searchParams.get('next')).toBe('/auth/reset-password');
});
