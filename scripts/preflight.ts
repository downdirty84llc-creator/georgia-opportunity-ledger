/**
 * Production readiness, checked rather than remembered.
 *
 *   npm run preflight            # check everything reachable from here
 *   npm run preflight -- --json  # machine-readable, for CI or a dashboard
 *
 * `docs/RUNBOOK.md` carries a twenty-four line launch checklist that a human
 * had to walk by hand, deciding for each line whether it was done. That is the
 * kind of task that reports success because nobody wanted to be the one who
 * said no. This runs every line that a machine can decide, and — the part that
 * matters — refuses to guess at the rest.
 *
 * Four outcomes, never three:
 *
 *   pass     checked, and it is right
 *   fail     checked, and it is wrong
 *   unknown  COULD NOT CHECK — counts as not ready, never as ready
 *   human    no machine can decide this one; it is owner work
 *
 * The `unknown` state is the whole point. This codebase has shipped, more than
 * once, a check that passed because it was looking at nothing: `smoke.sh`
 * reported "nothing sensitive is advertised" against a server that was not
 * running, and a bundle guard grepped an empty checkout and found no problems.
 * A readiness report that cannot tell "fine" from "did not look" is worse than
 * no report, because it is trusted.
 *
 * Exit status is 0 only when every blocking item passes. `human` items keep it
 * non-zero by design: they are real blockers, and the report names them so the
 * remaining work is a list rather than a feeling.
 */

import { resolveTxt } from 'node:dns/promises';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { LEGAL_DOCUMENTS } from '../src/lib/legal/documents';

type Status = 'pass' | 'fail' | 'unknown' | 'human';

interface Check {
  /** Checklist section this belongs to, matching RUNBOOK.md. */
  group: 'blocking' | 'customers' | 'post-launch';
  name: string;
  status: Status;
  detail: string;
}

const checks: Check[] = [];

function record(
  group: Check['group'],
  name: string,
  status: Status,
  detail: string,
): void {
  checks.push({ group, name, status, detail });
}

const env = (name: string): string => process.env[name] ?? '';
const isProduction = env('NEXT_PUBLIC_ENVIRONMENT') === 'production';

// ---------------------------------------------------------------------------
// Configuration. No network, no database — these are decidable from here.
// ---------------------------------------------------------------------------

function checkConfiguration(): void {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'CRON_SECRET',
  ];
  const missing = required.filter((name) => !env(name));
  record(
    'blocking',
    'Required environment variables',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0
      ? `all ${required.length} present`
      : `missing: ${missing.join(', ')}`,
  );

  record(
    'blocking',
    'NEXT_PUBLIC_ENVIRONMENT is production',
    isProduction ? 'pass' : 'fail',
    isProduction
      ? 'production'
      : `"${env('NEXT_PUBLIC_ENVIRONMENT') || '(unset)'}" — robots.ts will ` +
          'de-index the site and public-data reads will not fail the build',
  );

  const stripeKey = env('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    record('blocking', 'Stripe key is live mode', 'unknown', 'key not set');
  } else {
    const live = stripeKey.startsWith('sk_live_');
    record(
      'blocking',
      'Stripe key is live mode',
      live ? 'pass' : isProduction ? 'fail' : 'unknown',
      live
        ? 'live'
        : `test-mode key${isProduction ? ' in a production environment' : ' — expected outside production'}`,
    );
  }

  // Rotating CRON_SECRET must not invalidate every unsubscribe link already
  // sitting in an inbox, which is exactly what the fallback causes.
  const unsub = env('EMAIL_UNSUBSCRIBE_SECRET');
  record(
    'blocking',
    'EMAIL_UNSUBSCRIBE_SECRET is its own value',
    unsub && unsub !== env('CRON_SECRET') ? 'pass' : 'fail',
    !unsub
      ? 'unset — falls back to CRON_SECRET'
      : unsub === env('CRON_SECRET')
        ? 'identical to CRON_SECRET'
        : 'distinct',
  );

  const scannerUrl = env('FILE_SCANNER_URL');
  const scannerProvider = env('FILE_SCANNER_PROVIDER');
  record(
    'blocking',
    'FILE_SCANNER_URL configured',
    scannerUrl && scannerProvider !== 'none' ? 'pass' : 'fail',
    scannerUrl
      ? scannerProvider === 'none'
        ? 'URL set but provider is "none" — nothing will be scanned'
        : `${scannerProvider} at ${scannerUrl}`
      : 'unset — every attachment stores as skipped, readable and unscanned',
  );

  for (const [name, variable] of [
    ['Sentry configured', 'SENTRY_DSN'],
    ['PostHog configured', 'NEXT_PUBLIC_POSTHOG_KEY'],
  ] as const) {
    record(
      'customers',
      name,
      env(variable) ? 'pass' : 'fail',
      env(variable) ? 'set' : `${variable} unset`,
    );
  }
}

// ---------------------------------------------------------------------------
// Legal. Decidable from the source: the flag is what renders the banner.
// ---------------------------------------------------------------------------

function checkLegal(): void {
  const awaiting = LEGAL_DOCUMENTS.filter((doc) => doc.requiresReview);
  record(
    'blocking',
    'Legal review of the documents that need counsel',
    awaiting.length === 0 ? 'pass' : 'human',
    awaiting.length === 0
      ? `all ${LEGAL_DOCUMENTS.length} cleared`
      : `${awaiting.length} of ${LEGAL_DOCUMENTS.length} awaiting counsel: ` +
          awaiting.map((doc) => doc.slug).join(', '),
  );
}

// ---------------------------------------------------------------------------
// Database. Every one of these is a question only the live data can answer.
// ---------------------------------------------------------------------------

async function checkDatabase(): Promise<void> {
  const url = env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');

  const unknownAll = (reason: string) => {
    for (const name of [
      'No sample data in production',
      'Every subscription plan has its price ids',
      'At least two super administrators',
      'Every staff account has two-factor enrolled',
    ]) {
      record('blocking', name, 'unknown', reason);
    }
    record('customers', 'Background jobs are firing', 'unknown', reason);
  };

  if (!url || !key) {
    unknownAll('no Supabase URL or service-role key in the environment');
    return;
  }

  const db: SupabaseClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Prove the connection before trusting anything below it. Without this a
  // dead database makes every count come back null and every check "pass".
  const { error: reachError } = await db
    .from('subscription_plans')
    .select('code')
    .limit(1);
  if (reachError) {
    unknownAll(`database unreachable: ${reachError.message}`);
    return;
  }

  // --- sample data ---------------------------------------------------------
  const sampleTables = [
    'opportunities',
    'profiles',
    'reports',
    'market_indicator_values',
  ];
  const sampleCounts: string[] = [];
  let sampleUnknown: string | null = null;

  for (const table of sampleTables) {
    const { count, error } = await db
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('is_sample', true);
    if (error) {
      sampleUnknown = `${table}: ${error.message}`;
      break;
    }
    if ((count ?? 0) > 0) sampleCounts.push(`${table}=${count}`);
  }

  record(
    'blocking',
    'No sample data in production',
    sampleUnknown ? 'unknown' : sampleCounts.length === 0 ? 'pass' : 'fail',
    sampleUnknown ??
      (sampleCounts.length === 0
        ? `none across ${sampleTables.length} tables`
        : `sample rows present: ${sampleCounts.join(', ')}`),
  );

  // --- plan price ids ------------------------------------------------------
  const { data: plans, error: planError } = await db
    .from('subscription_plans')
    .select('code, stripe_monthly_price_id, stripe_annual_price_id')
    .neq('code', 'free');

  if (planError) {
    record(
      'blocking',
      'Every subscription plan has its price ids',
      'unknown',
      planError.message,
    );
  } else {
    const incomplete = (plans ?? []).filter(
      (plan) => !plan.stripe_monthly_price_id || !plan.stripe_annual_price_id,
    );
    record(
      'blocking',
      'Every subscription plan has its price ids',
      (plans ?? []).length === 0
        ? 'unknown'
        : incomplete.length === 0
          ? 'pass'
          : 'fail',
      (plans ?? []).length === 0
        ? 'no paid plans found — has the reference data been loaded?'
        : incomplete.length === 0
          ? `${(plans ?? []).length} paid plans, both ids on each`
          : `missing ids: ${incomplete.map((plan) => plan.code).join(', ')}`,
    );
  }

  // --- staff, super administrators and two-factor --------------------------
  const STAFF_ROLES = [
    'researcher',
    'reviewer',
    'editor',
    'support_representative',
    'billing_manager',
    'super_administrator',
  ];

  const { data: staff, error: staffError } = await db
    .from('profiles')
    .select('id, role, account_status')
    .in('role', STAFF_ROLES);

  if (staffError) {
    record(
      'blocking',
      'At least two super administrators',
      'unknown',
      staffError.message,
    );
    record(
      'blocking',
      'Every staff account has two-factor enrolled',
      'unknown',
      staffError.message,
    );
  } else {
    const active = (staff ?? []).filter(
      (person) => person.account_status === 'active',
    );
    const supers = active.filter(
      (person) => person.role === 'super_administrator',
    );

    record(
      'blocking',
      'At least two super administrators',
      supers.length >= 2 ? 'pass' : 'fail',
      `${supers.length} active — a lost authenticator needs an in-product ` +
        'recovery path, not a Supabase login',
    );

    const withoutFactor: string[] = [];
    let factorUnknown: string | null = null;

    for (const person of active) {
      const { data, error } = await db.auth.admin.mfa.listFactors({
        userId: person.id,
      });
      if (error) {
        factorUnknown = error.message;
        break;
      }
      const verified = (data?.factors ?? []).filter(
        (factor) => factor.status === 'verified',
      );
      if (verified.length === 0) withoutFactor.push(person.role);
    }

    record(
      'blocking',
      'Every staff account has two-factor enrolled',
      factorUnknown ? 'unknown' : withoutFactor.length === 0 ? 'pass' : 'fail',
      factorUnknown ??
        (active.length === 0
          ? 'no active staff accounts'
          : withoutFactor.length === 0
            ? `all ${active.length} enrolled`
            : `${withoutFactor.length} without a verified factor: ${withoutFactor.join(', ')}`),
    );
  }

  // --- background jobs -----------------------------------------------------
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: runCount, error: runError } = await db
    .from('job_runs')
    .select('*', { count: 'exact', head: true })
    .gte('started_at', dayAgo);

  record(
    'customers',
    'Background jobs are firing',
    runError ? 'unknown' : (runCount ?? 0) > 0 ? 'pass' : 'fail',
    runError
      ? runError.message
      : `${runCount ?? 0} job runs in the last 24 hours`,
  );
}

// ---------------------------------------------------------------------------
// External services. Reachable only from a network, so failures here are
// distinguished from "did not look".
// ---------------------------------------------------------------------------

/** The EICAR test string, assembled so this file is not itself quarantined. */
const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

async function checkScanner(): Promise<void> {
  const url = env('FILE_SCANNER_URL');
  if (!url || env('FILE_SCANNER_PROVIDER') === 'none') {
    record(
      'blocking',
      'Scanner detects the EICAR test file',
      'unknown',
      'no scanner configured to test',
    );
    return;
  }

  const boundary = `----preflight${Date.now()}`;
  const body =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file"; filename="eicar.com"\r\n' +
    'Content-Type: application/octet-stream\r\n\r\n' +
    `${EICAR}\r\n` +
    `--${boundary}--\r\n`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();

    // clamav-rest answers 406 with FOUND on a hit. Anything that is not an
    // explicit detection is treated as a failure: a scanner that returns 200
    // "clean" for EICAR is worse than none, because it is believed.
    const detected =
      response.status === 406 || /FOUND|infected|virus/i.test(text);
    record(
      'blocking',
      'Scanner detects the EICAR test file',
      detected ? 'pass' : 'fail',
      detected
        ? `detected (HTTP ${response.status})`
        : `NOT detected — HTTP ${response.status}: ${text.slice(0, 120)}`,
    );
  } catch (error) {
    record(
      'blocking',
      'Scanner detects the EICAR test file',
      'unknown',
      `could not reach the scanner: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function checkEmailDns(): Promise<void> {
  // EMAIL_FROM is "Name <address@domain>" or a bare address.
  const from = env('EMAIL_FROM');
  const domain = from.match(/@([^>\s]+)/)?.[1];

  if (!domain) {
    record(
      'blocking',
      'Email domain authentication (SPF, DKIM, DMARC)',
      'unknown',
      'no sending domain in EMAIL_FROM',
    );
    return;
  }

  // "The lookup failed" and "the record is not published" are different
  // answers, and collapsing them reports a domain as misconfigured when the
  // resolver simply could not be reached. ENOTFOUND and ENODATA are real
  // negatives — the server answered, and there is nothing there. Anything
  // else (timeout, SERVFAIL, refused) means this run does not know.
  type Lookup =
    { known: true; values: string[] } | { known: false; reason: string };

  const lookup = async (name: string): Promise<Lookup> => {
    try {
      const records = await resolveTxt(name);
      return { known: true, values: records.map((parts) => parts.join('')) };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      if (code === 'ENOTFOUND' || code === 'ENODATA') {
        return { known: true, values: [] };
      }
      return { known: false, reason: code };
    }
  };

  const [root, dmarc] = await Promise.all([
    lookup(domain),
    lookup(`_dmarc.${domain}`),
  ]);

  if (!root.known || !dmarc.known) {
    const reasons = [
      !root.known && `${domain} (${root.reason})`,
      !dmarc.known && `_dmarc.${domain} (${dmarc.reason})`,
    ].filter(Boolean);
    record(
      'blocking',
      'Email domain authentication (SPF, DKIM, DMARC)',
      'unknown',
      `DNS did not answer for ${reasons.join(', ')} — not a verdict on the records`,
    );
    return;
  }

  const hasSpf = root.values.some((value) => value.startsWith('v=spf1'));
  const hasDmarc = dmarc.values.some((value) => value.startsWith('v=DMARC1'));

  const missing = [!hasSpf && 'SPF', !hasDmarc && 'DMARC'].filter(
    Boolean,
  ) as string[];

  record(
    'blocking',
    'Email domain authentication (SPF, DKIM, DMARC)',
    missing.length === 0 ? 'pass' : 'fail',
    missing.length === 0
      ? `SPF and DMARC present on ${domain} (DKIM is selector-specific — verify with your provider)`
      : `${domain} missing: ${missing.join(', ')}`,
  );
}

async function checkPublicSite(): Promise<void> {
  const base = env('NEXT_PUBLIC_SITE_URL');
  if (!base || base.includes('localhost') || base.includes('127.0.0.1')) {
    for (const name of [
      'robots.txt serves the production ruleset',
      'Sitemap reachable',
    ]) {
      record(
        'post-launch',
        name,
        'unknown',
        'NEXT_PUBLIC_SITE_URL is not a deployed origin',
      );
    }
    return;
  }

  const get = async (path: string) => {
    try {
      const response = await fetch(`${base}${path}`, {
        signal: AbortSignal.timeout(15_000),
      });
      return {
        ok: response.ok,
        status: response.status,
        body: await response.text(),
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: error instanceof Error ? error.message : '',
      };
    }
  };

  const robots = await get('/robots.txt');
  if (robots.status === 0) {
    record(
      'post-launch',
      'robots.txt serves the production ruleset',
      'unknown',
      `unreachable: ${robots.body}`,
    );
  } else {
    // Outside production robots.ts blocks everything, so a misconfigured
    // NEXT_PUBLIC_ENVIRONMENT silently de-indexes the whole site.
    const blocksEverything = /Disallow:\s*\/\s*$/m.test(robots.body);
    record(
      'post-launch',
      'robots.txt serves the production ruleset',
      blocksEverything ? 'fail' : 'pass',
      blocksEverything
        ? 'serving the blocked ruleset — the site is de-indexed'
        : 'production ruleset',
    );
  }

  const sitemap = await get('/sitemap.xml');
  record(
    'post-launch',
    'Sitemap reachable',
    sitemap.status === 0 ? 'unknown' : sitemap.ok ? 'pass' : 'fail',
    sitemap.status === 0
      ? `unreachable: ${sitemap.body}`
      : `HTTP ${sitemap.status}`,
  );
}

// ---------------------------------------------------------------------------
// Owner work. Named rather than guessed at.
// ---------------------------------------------------------------------------

function recordHumanWork(): void {
  const items: Array<[Check['group'], string, string]> = [
    [
      'blocking',
      'Tier-by-tier test payment',
      'a card through each plan, confirming the access rank it grants ' +
        '(spec 28, milestone 3 acceptance)',
    ],
    [
      'blocking',
      'Database backups with point-in-time recovery',
      'enabled in the Supabase dashboard — not visible from the client API',
    ],
    [
      'customers',
      'Accessibility audit against WCAG 2.1 AA',
      'automated rules cover roughly a third; docs/ACCESSIBILITY-AUDIT.md is the brief',
    ],
    [
      'customers',
      'Administrator training on review and corrections',
      'the review queue and correction workflow, with a named owner',
    ],
    [
      'customers',
      'A real weekly report published, emailed and read at each tier',
      'end to end, with a live subscriber account at every rank',
    ],
    [
      'post-launch',
      'A cancellation and a failed payment, end to end',
      'access continues to period end then drops; grace window then downgrade',
    ],
  ];
  for (const [group, name, detail] of items)
    record(group, name, 'human', detail);
}

// ---------------------------------------------------------------------------

const SYMBOL: Record<Status, string> = {
  pass: '  ok  ',
  fail: ' FAIL ',
  unknown: '  ??  ',
  human: ' you  ',
};

function report(): number {
  const groups = [
    ['blocking', 'Blocking'],
    ['customers', 'Required before opening to customers'],
    ['post-launch', 'Verify after launch'],
  ] as const;

  for (const [key, title] of groups) {
    const rows = checks.filter((check) => check.group === key);
    if (rows.length === 0) continue;
    console.log(`\n${title}`);
    for (const row of rows) {
      console.log(`  [${SYMBOL[row.status]}] ${row.name}`);
      console.log(`           ${row.detail}`);
    }
  }

  const tally = (status: Status) =>
    checks.filter((check) => check.status === status).length;

  console.log(
    `\n${tally('pass')} pass · ${tally('fail')} fail · ` +
      `${tally('unknown')} could not check · ${tally('human')} owner work\n`,
  );

  const blockers = checks.filter(
    (check) => check.group === 'blocking' && check.status !== 'pass',
  );

  if (blockers.length === 0) {
    console.log(
      'Every blocking item passes. Launch is a decision, not a task.',
    );
    return 0;
  }

  console.log(`${blockers.length} blocking item(s) not satisfied:`);
  for (const blocker of blockers) {
    console.log(`  ${blocker.status === 'human' ? '·' : '!'} ${blocker.name}`);
  }
  console.log(
    '\n"could not check" is not "fine" — it means this run could not see ' +
      'enough to decide.\nRun it against the production environment for a ' +
      'verdict on those.',
  );
  return 1;
}

async function main(): Promise<void> {
  checkConfiguration();
  checkLegal();
  await checkDatabase();
  await Promise.all([checkScanner(), checkEmailDns(), checkPublicSite()]);
  recordHumanWork();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ checks }, null, 2));
    process.exit(
      checks.some(
        (check) => check.group === 'blocking' && check.status !== 'pass',
      )
        ? 1
        : 0,
    );
  }

  process.exit(report());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
