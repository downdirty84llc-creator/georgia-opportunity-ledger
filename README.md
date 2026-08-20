# Georgia Opportunity Ledger

A subscription intelligence platform for commercial property, business funding
and market pricing in Georgia. Public and authorised sources are monitored,
verified, scored against a published 100-point method, and distributed to
subscribers through a searchable database, a weekly report, immediate alerts and
a deadline calendar.

**Not** a brokerage, an MLS, a lender, an investment adviser, a legal service or
an appraisal service. Nothing it publishes guarantees eligibility, financing or
performance — that constraint is written into the product, not just the footer.

---

## Quick start

```bash
npm install
cp .env.example .env.local          # fill in Supabase and Stripe values

supabase start                      # local Postgres + Auth + Storage
supabase db reset                   # runs migrations, then supabase/seed.sql

# Demo users, sample records and sample reports. The environment has to be
# named: db:seed refuses to run when NEXT_PUBLIC_ENVIRONMENT is unset, so it
# cannot default its way into a database you did not mean to write to.
NEXT_PUBLIC_ENVIRONMENT=development \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
SUPABASE_SERVICE_ROLE_KEY=<the key `supabase start` printed> \
  npm run db:seed

npm run dev                         # http://localhost:3000
```

Seeding anything that is not localhost also needs `--remote` on the end, so a
remote write is always a thing somebody typed. `NEXT_PUBLIC_ENVIRONMENT=production`
is refused outright.

Seeded accounts (password from `SEED_PASSWORD`, default
`ledger-demo-password-2026`):

| Email                         | Role                   | Plan     |
| ----------------------------- | ---------------------- | -------- |
| `free.member@example.com`     | member                 | Free     |
| `weekly.member@example.com`   | member                 | Weekly   |
| `detailed.member@example.com` | member                 | Detailed |
| `premium.member@example.com`  | member                 | Premium  |
| `researcher@example.com`      | researcher             | —        |
| `reviewer@example.com`        | reviewer               | —        |
| `editor@example.com`          | editor                 | —        |
| `support@example.com`         | support representative | —        |
| `billing@example.com`         | billing manager        | —        |
| `admin@example.com`           | super administrator    | —        |

Everything the seeder writes carries `is_sample = true`, is badged in the UI, and
is excluded from production analytics. The seeder refuses to run when
`NEXT_PUBLIC_ENVIRONMENT=production`.

---

## Commands

| Command             | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `npm run dev`       | Development server                                  |
| `npm run build`     | Production build                                    |
| `npm run typecheck` | `tsc --noEmit`                                      |
| `npm run lint`      | ESLint                                              |
| `npm test`          | Unit and integration tests (Vitest)                 |
| `npm run test:e2e`  | End-to-end tests (Playwright, needs a running app)  |
| `npm run db:reset`  | Re-runs every migration and the reference-data seed |
| `npm run db:seed`   | Loads demo users and sample records                 |
| `npm run db:types`  | Regenerates database types from a live schema       |

---

## How access control works

This is the part to understand before changing anything.

A **rank** is a single integer answering "how much of a record may this account
read": Free 0, Weekly 10, Detailed 20, Premium 30, staff 100. Ranks are compared
with `>=` against an opportunity's `minimum_access_rank`, and they are spaced ten
apart so a tier can be inserted later without renumbering published content.

The rule is enforced in **three independent places**, deliberately:

1. **Row-level security** on every table. A leaked anon key gets nothing it
   should not have, whatever the application does. `supabase/verify-rls.sql`
   proves this rather than asserting it: it creates a member at each tier and
   checks that each sees exactly the records their rank allows.
2. **`public.search_opportunities`**, a `SECURITY DEFINER` function that applies
   column-level redaction — RLS is row-level and cannot express "this member may
   see the title but not the financials", which is exactly what the upsell
   requires.
3. **`src/lib/access`** in TypeScript, so the API can return a useful 402 with
   the plan that would unlock the record rather than an opaque empty result.

The TypeScript and SQL halves are kept in step by
`tests/unit/access/subscription.test.ts` and
`tests/unit/access/plan-parity.test.ts`, the latter of which diffs the compiled
plan matrix against `supabase/seed.sql`.

Administrator permissions are decided by **role**, never by plan. A Premium
member has rank 30 and no administrative access whatsoever.

---

## Repository layout

```
src/
  app/
    (marketing)/        Public pages: home, pricing, landing, legal, auth
    (member)/           Dashboard, search, detail, saved, calendar, reports,
                        account (profile, preferences, billing, email)
    (admin)/            Dashboard, review queue, seven-step opportunity editor,
                        report builder, sources, audit log, MFA setup, staff
                        two-factor administration
    api/v1/             Versioned API (spec section 10)
  components/           UI primitives and feature components
  lib/
    access/             Ranks, plan features, entitlement decisions
    alerts/             Alert matching and suppression
    billing/            Stripe client, subscription-status resolution
    db/                 Supabase clients (session-scoped, service-role, browser)
    email/              Provider abstraction, templates, unsubscribe tokens
    exports/            CSV generation and export jobs
    files/              Upload validation, content sniffing, virus scanning
    jobs/               Background jobs and the idempotent runner
    opportunities/      Lifecycle, workflow, query, serialisation
    observability/      Error reporting (Sentry envelope API, no SDK)
    reports/            Dependency-free PDF writer
    scoring/            The 100-point score
    search/             Filter schema, sorting, cursor pagination
supabase/
  migrations/           Schema, RLS, functions, triggers
  seed.sql              Reference data (plans, 159 counties, industries, sources)
scripts/seed.ts         Demo users and sample records
tests/                  Unit, integration and end-to-end tests
docs/                   Architecture, runbook, milestone status
```

---

## Environments

Development, staging and production each use their **own** database
credentials, auth credentials, Stripe keys, email keys, storage buckets, API
secrets and analytics project. Production data is never copied into development
without sanitisation.

Staging and production are separated by more than configuration: `robots.ts`
blocks indexing outside production, the seeder refuses to run in production, and
a banner marks every non-production page.

---

## Deployment

- **Application** — Netlify (`netlify.toml`), with Vercel supported as an
  alternative. The fourteen job schedules live in `src/lib/jobs/registry.ts`
  and both platforms' config is generated from it; `npm run schedules:check`
  fails CI if either has drifted. One caveat carries over to neither platform
  equally — see the runbook on function time limits.
- **Database, auth and storage** — Supabase Postgres.
- **Payments** — Stripe. Checkout, the customer portal and every card detail
  live in Stripe; this application never receives a card number.
- **Email** — Resend or Postmark behind `src/lib/email/client.ts`. Locally the
  `console` provider prints instead of sending, so a test run cannot email real
  people.

Background jobs authenticate with `CRON_SECRET`, compared in constant time.
Every run writes a `job_runs` row visible on the admin dashboard, and jobs that
must run once per window claim an idempotency key so a double-fire cannot send a
second round of emails.

See `docs/RUNBOOK.md` for the launch checklist and operational procedures.

---

## Testing

`npm test` runs 177 unit tests covering the parts where a quiet mistake costs
money or leaks paid content: score arithmetic and classification bands,
subscription-status resolution including the past-due grace window, entitlement
decisions per tier, alert matching and suppression keys, deadline lifecycle
transitions, CSV escaping and formula-injection defence, filter parsing,
unsubscribe token signing and tampering, upload content sniffing, and the legal
document set.

Accessibility runs in two suites: the public pages, and the twenty-two behind
sign-in including each step of the opportunity editor. `docs/ACCESSIBILITY-AUDIT.md`
is the brief for the human audit — what automation cannot reach, and what not to
pay someone to re-check.

`npm run test:e2e` runs Playwright against a built app across desktop, iPhone,
Android and tablet viewports. It includes the specification's security list —
unauthorised API access, direct URL access, identifier enumeration, injection,
webhook forgery, upload attacks, the cron-secret boundary — and WCAG 2.1 AA
checks on every public page.

Checks that need seeded data **skip** when it is absent rather than passing.
A green tick for an access-boundary test that never signed anyone in is worse
than no test at all, so the suite says which ones did not run and why.

---

## Administrator two-factor

Every staff role must enrol a TOTP factor before the admin area opens, and must
have presented it in the current session. Enrolment lives at `/admin/security`,
which is exempt from its own gate. The check fails open on an unexpected error —
a Supabase outage should not be indistinguishable from a missing second factor,
and row-level security still enforces every permission underneath.

Recovery for a lost authenticator is `/admin/staff`: a super administrator
clears the enrolment, with a mandatory reason on the audit row. Nobody can
reset their own, because a reset is a recovery path and needs a second person.

---

## Uploads

Attachments are checked three times before a member can reach one: the declared
type must be on the allowlist, the leading bytes must match what it claims to
be, and a virus scanner must clear it. Files are stored before they are scanned
and start life invisible — the read policy withholds anything not `clean` or
`skipped` — so a scan that never finishes leaves a file nobody can download
rather than one nobody checked. `scan-attachments` retries what did not resolve.

With no `FILE_SCANNER_URL` configured, files store as `skipped` and production
logs a warning on every upload. `skipped` says "not checked", never "clean".

---

## Status

Milestones 2 through 9 of the specification are implemented; see
`docs/MILESTONES.md` for the per-milestone breakdown and what remains.

Nothing that is left is code. Legal review of the nine documents marked
`requiresReview` is the hard launch blocker. The rest are deployment or
engagement tasks: a scanner endpoint for `FILE_SCANNER_URL`, running the
tier-by-tier payment matrix against a deployed environment, a human
accessibility audit, and brand sign-off.
