import { expect, test } from '@playwright/test';

// Verify the destination chosen by the real login form. Authentication and
// the destination page are intercepted; no real account is closed or opened.
for (const deletionPending of [true, false]) {
  test(`login navigates to ${deletionPending ? 'deletion controls' : 'the requested page'}`, async ({
    page,
  }) => {
    await page.route('**/api/v1/auth/session', (route) =>
      route.fulfill({ json: { data: { authenticated: false } } }),
    );
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        json: { data: { userId: 'member-1', deletionPending } },
      }),
    );
    const destination = deletionPending ? '/account' : '/reports';
    await page.route(
      (url) => ['/account', '/reports'].includes(url.pathname),
      (route) => route.abort(),
    );
    await page.goto('/login?next=/reports');
    await page.getByLabel('Email address').fill('member@example.test');
    await page.getByLabel('Password', { exact: true }).fill('fixture-password');
    const navigation = page.waitForRequest(
      (request) => new URL(request.url()).pathname === destination,
    );
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    expect(new URL((await navigation).url()).pathname).toBe(destination);
  });
}
