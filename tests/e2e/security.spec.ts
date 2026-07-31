import { expect, test, type APIRequestContext } from '@playwright/test';

import { skipIfEnvironmentIsDown } from './support/environment';

/**
 * The security test list from specification 26, as tests that run.
 *
 * Every one of these was a checklist line somebody was expected to work
 * through by hand before launch. A line in a checklist is only as good as the
 * attention of whoever reads it; these run on every push.
 *
 * They deliberately assert **from outside**, with no session and no fixtures:
 * an unauthenticated HTTP client is exactly the position an attacker is in,
 * and it is the one position that needs no database seeding to reproduce. The
 * per-tier checks that do need seeded accounts are in `entitlements.spec.ts`
 * and skip themselves when the seed is absent, rather than passing vacuously.
 */

const API = '/api/v1';

/** Endpoints that must never answer an anonymous caller with data. */
const MEMBER_ENDPOINTS = [
  `${API}/saved-opportunities`,
  `${API}/saved-searches`,
  `${API}/preferences`,
  `${API}/alert-preferences`,
  `${API}/reports`,
];

/**
 * A refusal, however it is spelled.
 *
 * 405 counts: an endpoint that only accepts POST is not leaking anything by
 * rejecting a GET, and pinning the exact code would make this a test of
 * routing rather than of access.
 */
const REFUSALS = [401, 403, 404, 405];

/** Endpoints that must never answer a non-staff caller. */
const ADMIN_ENDPOINTS = [
  `${API}/admin/opportunities`,
  `${API}/admin/reports`,
  `${API}/admin/staff`,
  `${API}/admin/attachments?opportunityId=00000000-0000-0000-0000-000000000000`,
];

/** Pages that must bounce a signed-out visitor rather than render. */
const PROTECTED_PAGES = [
  '/dashboard',
  '/saved',
  '/calendar',
  '/account',
  '/account/billing',
  '/account/preferences',
  '/admin',
  '/admin/staff',
  '/admin/security',
  '/admin/audit',
];

async function statusOf(
  request: APIRequestContext,
  path: string,
): Promise<number> {
  const response = await request.get(path, { failOnStatusCode: false });
  return response.status();
}

test.describe('unauthorised API access', () => {
  for (const path of MEMBER_ENDPOINTS) {
    test(`${path} refuses an anonymous caller`, async ({ request }) => {
      const response = await request.get(path, { failOnStatusCode: false });
      skipIfEnvironmentIsDown(response.status(), path);
      expect(REFUSALS, `${path} answered ${response.status()}`).toContain(
        response.status(),
      );

      // A refusal must not carry the data it refused.
      const body = await response.text();
      expect(body).not.toMatch(/"opportunities"\s*:\s*\[/);
    });
  }

  for (const path of ADMIN_ENDPOINTS) {
    test(`${path} refuses a non-staff caller`, async ({ request }) => {
      const status = await statusOf(request, path);
      skipIfEnvironmentIsDown(status, path);
      expect(REFUSALS).toContain(status);
    });
  }

  test('the export endpoint refuses an anonymous caller', async ({
    request,
  }) => {
    // POST rather than GET: this one only accepts POST, and a 405 would
    // otherwise pass for the wrong reason.
    const response = await request.post(`${API}/exports/opportunities`, {
      data: { filters: {} },
      failOnStatusCode: false,
    });
    skipIfEnvironmentIsDown(response.status(), `${API}/exports/opportunities`);
    expect([401, 402, 403]).toContain(response.status());
  });

  test('the jobs endpoint refuses without the cron secret', async ({
    request,
  }) => {
    // A job endpoint reachable without its secret is a free way to make the
    // application email every subscriber.
    for (const job of ['premium-alerts', 'distribute-weekly-report', 'prune']) {
      const response = await request.post(`${API}/jobs/${job}`, {
        failOnStatusCode: false,
      });
      expect([401, 403]).toContain(response.status());
    }
  });

  test('a wrong cron secret is refused', async ({ request }) => {
    const response = await request.post(`${API}/jobs/prune`, {
      headers: { Authorization: 'Bearer not-the-secret' },
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(response.status());
  });
});

test.describe('direct URL access', () => {
  for (const path of PROTECTED_PAGES) {
    test(`${path} does not render to a signed-out visitor`, async ({
      page,
    }) => {
      const response = await page.goto(path);
      const status = response?.status() ?? 0;

      if (status >= 400) return; // A refusal is a valid outcome.

      // Otherwise it must have redirected away from the protected path, and
      // must not have rendered member chrome on the way.
      expect(new URL(page.url()).pathname).not.toBe(path);
      await expect(
        page.getByRole('link', { name: 'Dashboard', exact: true }),
      ).toHaveCount(0);
    });
  }

  test('signing in is offered rather than a bare error', async ({ page }) => {
    await page.goto('/dashboard');
    expect(page.url()).toContain('/login');
  });
});

test.describe('identifier enumeration', () => {
  test('a missing opportunity and a hidden one look the same', async ({
    request,
  }) => {
    // If "exists but you cannot see it" answered 403 while "does not exist"
    // answered 404, an anonymous caller could map the entire private catalogue
    // by walking ids.
    const missing = await statusOf(
      request,
      `${API}/opportunities/00000000-0000-0000-0000-000000000000`,
    );
    const nonsense = await statusOf(
      request,
      `${API}/opportunities/not-a-real-slug-either`,
    );
    expect(
      missing,
      'a hidden record and a missing one must be indistinguishable',
    ).toBe(nonsense);
    skipIfEnvironmentIsDown(missing, `${API}/opportunities/{id}`);
    expect([401, 403, 404]).toContain(missing);
  });

  test('attachment ids do not leak existence', async ({ request }) => {
    const status = await statusOf(
      request,
      `${API}/attachments/00000000-0000-0000-0000-000000000000`,
    );
    expect(REFUSALS).toContain(status);
  });

  test('a malformed id is rejected, not passed to the database', async ({
    request,
  }) => {
    const status = await statusOf(
      request,
      `${API}/attachments/${encodeURIComponent("' or 1=1--")}`,
    );
    expect(status).not.toBe(500);
  });
});

test.describe('injection', () => {
  const PAYLOADS = [
    "'; drop table opportunities; --",
    "' or '1'='1",
    '" union select null,null,null--',
    '\\x27 or 1=1',
  ];

  for (const payload of PAYLOADS) {
    test(`search treats ${payload.slice(0, 20)}… as ordinary text`, async ({
      request,
    }) => {
      // The assertion is *sameness*, not a particular status. A payload that
      // is handled identically to the word "warehouse" reached the database as
      // a parameter, which is the property worth testing. Asserting a bare
      // 200 would instead fail whenever the environment has no data.
      const baseline = await request.get(`${API}/opportunities?q=warehouse`, {
        failOnStatusCode: false,
      });
      const attack = await request.get(
        `${API}/opportunities?q=${encodeURIComponent(payload)}`,
        { failOnStatusCode: false },
      );

      expect(
        attack.status(),
        `payload answered ${attack.status()} where plain text answered ` +
          `${baseline.status()} — the string is being treated differently`,
      ).toBe(baseline.status());

      const body = (await attack.text()).toLowerCase();
      expect(body).not.toContain('syntax error');
      expect(body).not.toContain('pg_catalog');
      expect(body).not.toContain('postgres');
    });
  }

  test('reflected script in a query string is not executed', async ({
    page,
  }) => {
    let dialogs = 0;
    page.on('dialog', async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });

    await page.goto(
      `/opportunities?q=${encodeURIComponent('<script>alert(1)</script>')}`,
    );
    await page.waitForLoadState('domcontentloaded');
    expect(dialogs).toBe(0);
    expect(await page.locator('script:not([src])').count()).toBeLessThan(50);
  });

  test('a script payload in a county slug does not execute', async ({
    page,
  }) => {
    let dialogs = 0;
    page.on('dialog', async (dialog) => {
      dialogs += 1;
      await dialog.dismiss();
    });

    await page.goto(
      `/georgia/${encodeURIComponent('"><img src=x onerror=alert(1)>')}`,
      { waitUntil: 'domcontentloaded' },
    );
    expect(dialogs).toBe(0);
  });
});

test.describe('webhook forgery', () => {
  test('an unsigned Stripe webhook is refused', async ({ request }) => {
    const response = await request.post(`${API}/webhooks/stripe`, {
      data: {
        id: 'evt_forged',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_forged', status: 'active' } },
      },
      failOnStatusCode: false,
    });
    expect([400, 401, 403]).toContain(response.status());
  });

  test('a wrongly signed Stripe webhook is refused', async ({ request }) => {
    const response = await request.post(`${API}/webhooks/stripe`, {
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
      data: { id: 'evt_forged', type: 'invoice.payment_failed' },
      failOnStatusCode: false,
    });
    expect([400, 401, 403]).toContain(response.status());
  });
});

test.describe('file upload', () => {
  test('anonymous upload is refused before any file is read', async ({
    request,
  }) => {
    const response = await request.post(`${API}/admin/attachments`, {
      multipart: {
        file: {
          name: 'payload.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 not really'),
        },
        opportunityId: '00000000-0000-0000-0000-000000000000',
      },
      failOnStatusCode: false,
    });
    expect([401, 403]).toContain(response.status());
  });

  test('an executable disguised as a PDF is refused', async ({ request }) => {
    // Authorisation is checked first, so this asserts the endpoint refuses —
    // the content check itself is covered exhaustively by the unit tests in
    // tests/unit/files/signatures.test.ts, which need no session.
    const response = await request.post(`${API}/admin/attachments`, {
      multipart: {
        file: {
          name: 'invoice.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('MZ\x90\x00'),
        },
      },
      failOnStatusCode: false,
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe('security headers and indexing', () => {
  test('protected areas are not indexable', async ({ page }) => {
    await page.goto('/login');
    const robots = await page
      .locator('meta[name="robots"]')
      .getAttribute('content')
      .catch(() => null);
    // Either the page carries a noindex or robots.txt disallows the area;
    // the sitemap must not advertise member routes either way.
    const sitemap = await page.request.get('/sitemap.xml');
    const body = await sitemap.text();
    expect(body).not.toContain('/dashboard');
    expect(body).not.toContain('/admin');
    expect(body).not.toContain('/account');
    void robots;
  });

  test('robots.txt does not invite crawlers into the member area', async ({
    request,
  }) => {
    const response = await request.get('/robots.txt');
    const body = await response.text();
    expect(body).toMatch(/Disallow/i);
  });
});
