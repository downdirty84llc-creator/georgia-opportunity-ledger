import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * WCAG 2.1 AA behind the sign-in wall (specification 22).
 *
 * The public pages have been checked since the accessibility suite was written.
 * These twenty-two had nothing — which is backwards, because the public pages
 * are mostly prose and these are where the interaction lives: a seven-step
 * editor with autosave, a report builder with keyboard reordering, a
 * preferences form with six multi-select groups. Keyboard traps and lost focus
 * do not happen on a landing page.
 *
 * Needs `npm run db:seed`. Skips loudly without it, like the entitlement
 * suite: an accessibility check that never rendered the page is not a pass.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'ledger-demo-password-2026';
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const MEMBER_PAGES = [
  '/dashboard',
  '/opportunities',
  '/saved',
  '/calendar',
  '/reports',
  '/account',
  '/account/preferences',
  '/account/billing',
  '/account/email-preferences',
];

const ADMIN_PAGES = [
  '/admin',
  '/admin/review-queue',
  '/admin/opportunities',
  '/admin/opportunities/new',
  '/admin/reports',
  '/admin/sources',
  '/admin/audit',
  '/admin/staff',
];

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

function describeViolations(
  violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations'],
): string {
  return violations
    .map((violation) => {
      const targets = violation.nodes
        .slice(0, 3)
        .map((node) => node.target.join(' '))
        .join('\n      ');
      return `  [${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}\n      ${targets}`;
    })
    .join('\n');
}

async function auditPages(page: Page, paths: string[]): Promise<void> {
  const failures: string[] = [];

  for (const path of paths) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    // A redirect means the account cannot reach it; that is an entitlement
    // question, answered elsewhere, not an accessibility result.
    if (new URL(page.url()).pathname !== path) continue;

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
    if (results.violations.length > 0) {
      failures.push(`${path}\n${describeViolations(results.violations)}`);
    }
  }

  // Every page is reported at once. Failing on the first would mean fixing
  // twenty-two defects in twenty-two runs.
  expect(failures.join('\n\n'), 'accessibility violations').toBe('');
}

test.describe('member area', () => {
  test('every member page passes the automated rules', async ({ page }) => {
    test.skip(
      !(await signIn(page, 'premium.member@example.com')),
      'No seeded premium account. Run `npm run db:seed` first.',
    );
    await auditPages(page, MEMBER_PAGES);
  });

  test('the preferences form is operable by keyboard alone', async ({
    page,
  }) => {
    test.skip(
      !(await signIn(page, 'premium.member@example.com')),
      'No seeded premium account. Run `npm run db:seed` first.',
    );

    await page.goto('/account/preferences');
    await page.waitForLoadState('networkidle');

    // Tab through the whole form and confirm focus keeps moving. A control
    // that swallows Tab is the classic keyboard trap, and it is invisible to
    // axe because the markup is fine — it is the behaviour that is wrong.
    const seen = new Set<string>();
    let stuck = 0;
    for (let step = 0; step < 60; step += 1) {
      await page.keyboard.press('Tab');
      const here = await page
        .locator(':focus')
        .evaluate(
          (el) =>
            `${el.tagName}#${el.id || ''}.${(el.className || '').toString().slice(0, 40)}`,
        )
        .catch(() => 'none');

      if (seen.has(here)) {
        stuck += 1;
        expect(stuck, `focus stopped moving at ${here}`).toBeLessThan(4);
      } else {
        stuck = 0;
        seen.add(here);
      }
    }
    expect(
      seen.size,
      'almost nothing was reachable by keyboard',
    ).toBeGreaterThan(5);
  });
});

test.describe('admin area', () => {
  test('every admin page passes the automated rules', async ({ page }) => {
    const ok = await signIn(page, 'editor@example.com');
    test.skip(!ok, 'No seeded editor account. Run `npm run db:seed` first.');

    // The admin area is behind a two-factor gate. Without an enrolled factor
    // it redirects to /admin/security, which `auditPages` skips as a redirect
    // — so the run would silently audit nothing. Say so instead.
    await page.goto('/admin');
    test.skip(
      new URL(page.url()).pathname.startsWith('/admin/security'),
      'The seeded editor has no enrolled second factor, so the admin area ' +
        'redirects to enrolment. Enrol one to audit these pages.',
    );

    await auditPages(page, ADMIN_PAGES);
  });

  test('the opportunity editor passes on every step', async ({ page }) => {
    const ok = await signIn(page, 'editor@example.com');
    test.skip(!ok, 'No seeded editor account. Run `npm run db:seed` first.');

    await page.goto('/admin/opportunities/new');
    await page.waitForLoadState('networkidle');
    test.skip(
      !new URL(page.url()).pathname.startsWith('/admin/opportunities'),
      'Editor cannot reach the opportunity editor; check the two-factor gate.',
    );

    const failures: string[] = [];
    // Each step swaps the whole fieldset. A heading level or label that is
    // right on step one can be wrong on step five, and only stepping through
    // finds it.
    for (let step = 1; step <= 7; step += 1) {
      const results = await new AxeBuilder({ page })
        .withTags(WCAG_AA)
        .analyze();
      if (results.violations.length > 0) {
        failures.push(
          `step ${step}\n${describeViolations(results.violations)}`,
        );
      }

      const next = page.getByRole('button', { name: /next|continue/i }).first();
      if ((await next.count()) === 0) break;
      if (!(await next.isEnabled())) break;
      await next.click();
      await page.waitForTimeout(200);
    }

    expect(failures.join('\n\n'), 'editor accessibility violations').toBe('');
  });
});
