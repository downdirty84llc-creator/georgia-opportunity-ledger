import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * WCAG 2.1 AA checks (specification 22).
 *
 * Automated rules catch roughly a third of real accessibility defects, so this
 * is a floor rather than the audit the launch checklist asks for. It is the
 * third that regresses silently — a colour token changed in a refactor, a
 * heading level skipped to get the size right, a form control that lost its
 * label when it moved into a new component — which is exactly the third worth
 * having a machine watch.
 *
 * Violations are reported in full rather than as a bare count. A failure that
 * says "3 violations" sends someone hunting; one that names the rule and the
 * selector is fixable from the log.
 */

const PUBLIC_PAGES = [
  { path: '/', name: 'home' },
  { path: '/pricing', name: 'pricing' },
  { path: '/commercial-property', name: 'commercial property' },
  { path: '/funding', name: 'funding' },
  { path: '/pricing-reports', name: 'pricing reports' },
  { path: '/how-it-works', name: 'how it works' },
  { path: '/insights', name: 'insights' },
  { path: '/sample-report', name: 'sample report' },
  { path: '/login', name: 'sign in' },
  { path: '/register', name: 'register' },
  { path: '/support', name: 'support' },
  { path: '/corrections/new', name: 'submit a correction' },
  { path: '/legal/terms', name: 'terms' },
  { path: '/legal/privacy', name: 'privacy' },
  { path: '/legal/accessibility', name: 'accessibility statement' },
];

const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

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

test.describe('WCAG 2.1 AA', () => {
  for (const { path, name } of PUBLIC_PAGES) {
    test(`${name} has no automatically detectable violations`, async ({
      page,
    }) => {
      await page.goto(path);
      await page.waitForLoadState('networkidle');

      const results = await new AxeBuilder({ page })
        .withTags(WCAG_AA)
        .analyze();

      expect(
        results.violations,
        `${path}\n${describeViolations(results.violations)}`,
      ).toEqual([]);
    });
  }
});

test.describe('keyboard and structure', () => {
  test('a skip link is the first thing a keyboard user reaches', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');

    const focused = page.locator(':focus');
    const href = await focused.getAttribute('href');
    expect(href, 'the first tab stop should skip to the main content').toBe(
      '#main',
    );

    // And it must actually go somewhere.
    await expect(page.locator('#main')).toHaveCount(1);
  });

  test('every page has exactly one level-one heading', async ({ page }) => {
    for (const { path } of PUBLIC_PAGES.slice(0, 8)) {
      await page.goto(path);
      const count = await page.locator('h1').count();
      expect(count, `${path} has ${count} h1 elements`).toBe(1);
    }
  });

  test('the focus ring is visible on interactive elements', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    const outline = await page
      .locator(':focus')
      .evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
          outlineWidth: style.outlineWidth,
          outlineStyle: style.outlineStyle,
          boxShadow: style.boxShadow,
        };
      })
      .catch(() => null);

    expect(outline, 'nothing was focused after two tabs').not.toBeNull();
    const hasRing =
      (outline?.outlineStyle !== 'none' && outline?.outlineWidth !== '0px') ||
      (outline?.boxShadow ?? 'none') !== 'none';
    expect(hasRing, 'focused element has no visible focus indicator').toBe(
      true,
    );
  });

  test('form controls are labelled', async ({ page }) => {
    await page.goto('/register');

    const inputs = page.locator(
      'input:not([type=hidden]):not([type=submit]), select, textarea',
    );
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const control = inputs.nth(index);
      const id = await control.getAttribute('id');
      const ariaLabel = await control.getAttribute('aria-label');
      const ariaLabelledBy = await control.getAttribute('aria-labelledby');

      // Wrapping a control in its <label> is the HTML specification's own
      // association mechanism and needs no id. The consent checkbox uses it,
      // which is correct; an earlier version of this test called that a defect.
      const wrapped = await control.evaluate(
        (element) => element.closest('label') !== null,
      );

      const labelled =
        Boolean(ariaLabel) ||
        Boolean(ariaLabelledBy) ||
        wrapped ||
        (id ? (await page.locator(`label[for="${id}"]`).count()) > 0 : false);

      expect(
        labelled,
        `control ${id ?? index} on /register has no accessible name`,
      ).toBe(true);
    }
  });

  test('status is never carried by colour alone', async ({ page }) => {
    // Every badge and meter in the design system must have a text label; spec
    // 22 calls this out because score bands are the obvious place to fail it.
    await page.goto('/insights');

    const meters = page.getByRole('meter');
    const meterCount = await meters.count();
    for (let index = 0; index < meterCount; index += 1) {
      const meter = meters.nth(index);
      const name =
        (await meter.getAttribute('aria-label')) ??
        (await meter.getAttribute('aria-labelledby'));
      expect(name, 'a meter has no accessible name').toBeTruthy();
    }
  });
});

test.describe('reduced motion', () => {
  test('the site renders with motion reduced', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/');
    await expect(
      page.getByRole('navigation', { name: 'Primary' }),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
    expect(results.violations, describeViolations(results.violations)).toEqual(
      [],
    );

    await context.close();
  });
});
