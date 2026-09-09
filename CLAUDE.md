# CLAUDE.md

Guidance for AI assistants working in this repository.

---

## 0. Orientation — read this first

- This is the **canonical home of the Georgia Opportunity Ledger**. The
  repository name and the `package.json` name agree; there is nothing to
  reconcile.
- **The default branch is `main`.** Base new work on it.
- An older copy of this application lives in
  **`downdirty84llc-creator/tune-advisor-`**, on branch
  `claude/claude-md-docs-cqvhy6`. It is **retired as of 2026-09-09**. It ran
  behind this repository on the application — no scanner pipeline, no
  super-administrator MFA reset, four fewer migrations — but it was the only
  place the DD84 agent platform existed. That platform has now been brought
  here, which is what §10 describes. **Do not go back to `tune-advisor-` for
  application code**, and do not restore its branch: two divergent copies of
  this app is the exact failure that consolidation removed.
- The Ledger is one workstream inside **Down Dirty 84 LLC (DD84)**, an
  automotive performance-tuning business. DD84's operating governance for agents
  is in `docs/DD84-OPERATIONS-AGENT.md`, summarised in §10. That protocol governs
  _how you work_; the rest of this file describes _what the code is_.

### What the product is

A subscription intelligence platform for commercial property, business funding
and market pricing in Georgia. Public and authorised sources are monitored,
verified, scored against a published 100-point method, and distributed to
subscribers through a searchable database, a weekly report, immediate alerts and
a deadline calendar.

It is explicitly **not** a brokerage, MLS, lender, investment adviser, legal
service or appraisal service. That constraint is enforced in product copy and
data handling, not just in a footer disclaimer — see §9 on data honesty.

---

## 1. Stack and commands

Next.js 15 (App Router) · React 19 · TypeScript (strict) · Tailwind ·
Supabase (Postgres + Auth + Storage) · Stripe · Vitest · Playwright.
Node `>=20.9.0`; Netlify builds on Node 22.

| Command                           | What it does                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                     | Development server on :3000                                          |
| `npm run build`                   | Production build                                                     |
| `npm run typecheck`               | `tsc --noEmit`                                                       |
| `npm run lint`                    | ESLint (`next lint`)                                                 |
| `npm test`                        | Unit tests (Vitest, node env)                                        |
| `npm run test:e2e`                | Playwright; builds and starts the app unless `E2E_BASE_URL` is set   |
| `npm run test:e2e:security`       | Just the security and accessibility specs                            |
| `npm run schedules:generate`      | Regenerates `netlify/functions/*` from `src/lib/jobs/registry.ts`    |
| `npm run schedules:check`         | Fails if the committed schedules have drifted from the registry      |
| `npm run preflight`               | Pre-deployment environment and configuration check                   |
| `npm run smoke`                   | Smoke script against a running instance                              |
| `npm run db:reset`                | Re-runs every migration, then `supabase/seed.sql`                    |
| `npm run db:seed`                 | Demo users and sample records (`scripts/seed.ts`)                    |
| `npm run db:verify`               | Schema verification against a live database                          |
| `npm run db:types`                | Regenerates `src/lib/db/generated-types.ts` from a live local schema |
| `npm run stripe:setup`            | Creates the products and prices (`scripts/stripe-setup.ts`)          |
| `npm run format` / `format:check` | Prettier over `ts,tsx,md,json`                                       |

**Before you hand back any change, `npm run typecheck && npm run lint && npm test`
must all pass.** As of the current HEAD all three are clean: typecheck silent,
lint reports no warnings or errors, and Vitest runs **240 tests in 18 files, all
passing**. If your change makes any of these red, that is your change.

`npm test` needs no database — every unit test is pure logic. Database-backed
behaviour is covered by `npm run test:e2e` against a built app.

Local setup:

```bash
npm install
cp .env.example .env.local      # fill in Supabase and Stripe values
supabase start                  # local Postgres + Auth + Storage
supabase db reset               # migrations, then supabase/seed.sql
npm run db:seed                 # demo users, sample records, sample reports
npm run dev
```

Everything the seeder writes carries `is_sample = true`, is badged in the UI,
is carried into CSV exports, and is excluded from the admin dashboard's
subscriber count, MRR and failed-payment tiles and from the
`aggregate-analytics` job via `src/lib/analytics/sample-data.ts`. The seeder
**refuses to run** when `NEXT_PUBLIC_ENVIRONMENT=production`.

---

## 2. Repository layout

```
src/
  middleware.ts         Session refresh, route guarding, pathname header
  app/
    (marketing)/        Public: home, pricing, landing pages, legal, auth
    (member)/           Dashboard, search, detail, saved, calendar, reports, account
    (admin)/            Dashboard, review queue, opportunity editor, report
                        builder, sources, audit log, staff/MFA, attachments
    api/v1/             Versioned API — the only API surface
    auth/callback       OAuth / magic-link exchange
  components/           ui/primitives.tsx plus feature components
  lib/
    access/             Ranks, plan features, entitlement decisions
    alerts/             Alert matching and suppression keys
    analytics/          Events, server-side PostHog forwarding, sample-data
                        exclusion, upgrade-source attribution
    auth/               Session context, MFA status, administrative MFA reset
    billing/            Stripe client, subscription status, MRR arithmetic
    db/                 Supabase clients — see §4
    email/              Provider abstraction, templates, unsubscribe tokens
    exports/            CSV generation and export jobs
    files/              Attachment handling, signature sniffing, virus scanner
    http/               Response helpers, rate limiting
    jobs/               Job definitions, registry, idempotent runner
    legal/              The ten legal and policy documents
    observability/      Sentry envelope reporting (no SDK)
    opportunities/      Lifecycle, workflow, query, serialisation, editor schema
    reports/            Dependency-free PDF writer
    scoring/            The 100-point score
    search/             Filter schema, sorting, cursor pagination
supabase/
  migrations/           31 files, applied in order
  seed.sql              Reference data: plans, 159 counties, industries, sources
netlify/functions/      14 scheduled functions, GENERATED — see §7
scripts/                seed, generate-schedules, preflight, smoke, verify-schema,
                        stripe-setup
tests/unit, tests/e2e   Vitest and Playwright
docs/                   ARCHITECTURE, MILESTONES, RUNBOOK, ACCESSIBILITY-AUDIT,
                        DD84-OPERATIONS-AGENT, DD84-GROWTH-AGENT
  agents/               Venture registry and the Rev agent README
  ops/                  Torque's control plane: tasks, approvals, operating log
  growth/               Rev's record: registers, campaign kits, briefs
.claude/agents/         torque.md (operations), rev.md (marketing & revenue)
.claude/commands/       Torque's six routines
.claude/skills/         Rev's two skills
```

**Migration numbering is not uniform, and that is fine.** Most files are
`20260101NNNNNN_*`, a first-cut sequence. Later ones carry real timestamps
(`20260801032955_`, `20260803160830_`, `20260804003224_`, `20260810091020_`)
because they were written after the project went to a live database. Order is
what matters and the ordering is correct. **Never edit an applied migration; add
a new one.**

Import alias: `@/*` → `./src/*`. Use it; do not write deep relative paths.

---

## 3. The access model — understand this before changing anything

A **rank** is one integer answering "how much of a record may this account
read": Free 0, Weekly 10, Detailed 20, Premium 30, staff 100
(`src/lib/access/ranks.ts`). Ranks are compared with `>=` against an
opportunity's `minimum_access_rank`, and are **spaced ten apart so a tier can be
inserted later without renumbering published content**. Preserve that spacing.

The rule is enforced in **three independent places, deliberately**:

| Layer                                              | Enforces                              | Fails safe by                        |
| -------------------------------------------------- | ------------------------------------- | ------------------------------------ |
| Row-level security                                 | Which rows exist for this key         | Returning nothing                    |
| `public.search_opportunities` (`SECURITY DEFINER`) | Which **columns** this rank may read  | Returning `NULL`                     |
| `src/lib/access` (TypeScript)                      | Which capabilities this plan includes | Returning a `Decision` with a reason |

Why all three: RLS is row-level and cannot express "this member may see the
title but not the financials", which is exactly what the upsell needs. The
TypeScript layer exists for _messaging_ — it lets the API answer **402
`upgrade_required`** naming the plan that unlocks the record, which a bare RLS
denial cannot express. The anon key is public by design, so a caller hitting
the RPC directly gets exactly what the app would have shown them.

**Rules that follow from this:**

- Administrator permissions are decided by **role**, never by rank or plan. A
  Premium member has rank 30 and zero administrative access. Never write
  `rank >= 100` where you mean `is_staff()`.
- The plan matrix exists twice — `subscription_plans.feature_configuration` in
  the database and `PLAN_FEATURE_DEFAULTS` in TypeScript. The database wins at
  runtime; the compiled table lets the app boot and render pricing.
  **`tests/unit/access/plan-parity.test.ts` diffs the compiled table against
  `supabase/seed.sql` on every run** — if you change one, change both or that
  test fails.
- `effectiveAccessRank` folds account status, role, subscription state and any
  super-admin override into the single answer. Suspended/closed → rank 0
  immediately, including for staff. Cancelled keeps access to period end
  (it has been paid for). Past-due keeps access through the period **plus a
  three-day grace window**. `cancel_at_period_end` deliberately does **not**
  reduce access.
- Locked records are returned as **teasers, not hidden** — the upgrade prompt is
  the point. Teasers come from `public.opportunity_previews`, a narrow view
  carrying no analysis, financial, eligibility or source-URL fields.

---

## 4. Choosing a Supabase client

Four clients, and picking the wrong one is a security bug:

| Module                                        | Use when                                                 | Notes                                                                        |
| --------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `db/server.ts` `createServerSupabaseClient()` | **Default** for anything on behalf of a signed-in member | Session-bound, RLS applies. Calls `cookies()`, so the route becomes dynamic. |
| `db/public.ts` / `lib/public-data.ts`         | Public marketing pages reading teaser views only         | Anonymous, **cookie-free** — this is what keeps those routes cacheable       |
| `db/admin.ts` `createAdminClient()`           | Stripe webhook, background jobs, seed script **only**    | Service-role key, **bypasses RLS entirely**                                  |
| `db/browser.ts`                               | Client components                                        | Anon key                                                                     |

Never reach for `createAdminClient()` in a member-facing path. If a handler
needs it, that is a signal the access model is being worked around.

The cookie-free public path exists because of a real bug: marketing loaders used
the session-bound client, which forced per-request rendering, and their
`try/catch` swallowed Next.js's `DynamicServerError` — the framework's
control-flow exception for "bail out of static generation". Catching that and
returning empty data produces a permanently blank homepage with no error logged.
**Do not wrap data loaders in a bare `catch` that returns empty.**

**The site header is the other half of that.** `SiteHeader` takes an _optional_
already-resolved session. Public pages omit it, and
`components/site/header-session.tsx` resolves the session in the browser
instead — which is what keeps the marketing routes cacheable. Member and admin
shells pass the session in, because those routes are dynamic anyway and the
correct header should be in the first byte. **Do not make the public header
resolve a session on the server**; it silently makes every marketing page
per-request.

Session resolution: `getSessionContext()` in `src/lib/auth/session.ts` is wrapped
in React's `cache`, so a layout, page and three components checking entitlements
cost one round trip. It uses `auth.getUser()` — which validates the token with
the auth server — never `getSession()`, which trusts the cookie as-is. On a page
deciding what paid content to render, that difference matters.

---

## 5. API conventions (`src/app/api/v1/**`)

One response shape, from `src/lib/http/responses.ts`:

```
success: { data, meta? }
failure: { error: { code, message, details? } }
```

Codes map to status in `STATUS_BY_CODE`: `bad_request` 400, `unauthorized` 401,
`forbidden` 403, **`upgrade_required` 402**, `not_found` 404, `conflict` 409,
`validation_failed` 422, `rate_limited` 429, `internal_error` 500.

Every route handler follows the same skeleton — see
`src/app/api/v1/opportunities/route.ts` as the reference implementation:

1. `export const dynamic = 'force-dynamic';`
2. Wrap the handler in `withErrorHandling(...)` — it converts a thrown `ZodError`
   into a 422, reports anything else to Sentry, and returns a 500 with **no
   internal detail in the body**.
3. Parse input with a Zod schema, `safeParse`, return `validationFailed(error)`.
4. `getViewer()` / `getSessionContext()` for identity.
5. `checkRateLimit(bucket, rateLimitIdentity(request, viewer.userId))`, return
   `rateLimited(limit.resetAt)` when refused.
6. Reject suspended accounts explicitly.
7. Use `denied(decision)` to turn an entitlement `Decision` into the right
   failure — do not hand-roll the 402.
8. Return `ok(data, meta, { headers: rateLimitHeaders(limit) })`.

Rate limiting lives in Postgres (`public.check_rate_limit`, one atomic upsert),
not in process — serverless instances would each keep their own counter, which
is no limit at all. Windows are **fixed, not sliding** (a fixed window can admit
up to 2× across a boundary; that is an accepted trade for one indexed write).
The limiter **fails open** and logs when it does — a database hiccup must not
lock every member out of search.

Marketing pages use `export const revalidate = <seconds>` (300–900). The member,
admin and API paths are marked `private, no-store` in `next.config.mjs` because
their content is per-user and rank-dependent. Next.js already sends no-store for
a dynamically rendered route and all of these read cookies, so the header is
belt-and-braces; the reason it is written out anyway is that the automatic
behaviour follows from how a route happens to render, and a refactor that made
one of them static would drop the header with nothing to notice. **Add new
member routes to that matcher group.**

Two routes declare a longer `maxDuration`: `/api/v1/jobs/[job]` at 300s because
jobs iterate the whole member list, and `/api/v1/admin/attachments` at 60s
because uploads are read whole to be scanned. **Vercel reads those exports;
Netlify does not** — see `netlify.toml`, which carries the same budgets in its
own configuration. Changing one means changing both.

---

## 6. Editorial workflow and the audit log

Separation of duties is enforced by software
(`src/lib/opportunities/workflow.ts`), not convention:

- **Researcher** drafts and submits; cannot publish, score, or change who may see
  a record.
- **Reviewer** approves, returns with notes, sets component scores.
- **Editor** publishes.

Nobody carries a record from draft to publication alone. Two details that are
easy to break:

- **`workflow_status` is deliberately not accepted by the content `PATCH`
  endpoint.** Otherwise a researcher could publish by PATCHing a field they are
  allowed to edit. Workflow moves live on dedicated action endpoints
  (`/approve`, `/publish`, `/submit-review`, `/expire`, `/reverify`) that
  re-check the role. Do not "simplify" this by accepting the field.
- `missingPublishFields` blocks publication of a record lacking the analysis a
  subscriber is paying for, **at the API** rather than only in the form, so a
  record published through a script cannot skip it.

`audit_logs` is **append-only**. There is no update or delete policy for anyone,
including super administrators, so the trail cannot be rewritten from any client
key. `write_audit_log` is `SECURITY DEFINER`, and Postgres grants `EXECUTE` on
such functions to `PUBLIC` by default — which would let any signed-in member
forge entries — so execution is revoked and the app calls `log_admin_action`, a
guarded wrapper that checks `is_staff()` first. Keep that pattern for any new
`SECURITY DEFINER` function: **create it, then revoke `EXECUTE` from `PUBLIC`.**

---

## 7. Background jobs — and the generated schedules

Fourteen jobs. **The registry is the single source of truth**:
`src/lib/jobs/registry.ts` holds each job and its cadence, and
`netlify/functions/*.ts` are **generated from it** by
`npm run schedules:generate`. `npm run schedules:check` fails the build when the
committed files have drifted.

**Do not hand-edit `netlify/functions/`.** Change the registry and regenerate.
This exists because the older arrangement — a schedule in the registry and the
same schedule copied into a deployment config — drifts silently, and a job that
stops firing looks exactly like a job with nothing to do.

`vercel.json` still carries the same fourteen crons for a Vercel deployment.
It is **not** generated, so if you change a cadence, change it too. Note that
five of those cron expressions are sub-daily, which a Vercel Hobby plan rejects
at deploy time — Netlify has no such restriction, which is part of why the
Netlify path is the maintained one.

Jobs authenticate with `CRON_SECRET` compared in constant time, accept both
`GET` and `POST`, and every run writes a `job_runs` row visible on the admin
dashboard.

**Idempotency — three mechanisms, because three different things double-fire:**

- **Stripe webhooks**: the insert into `billing_events` _is_ the lock. Its
  unique `stripe_event_id` makes a retry conflict and be acknowledged without
  reprocessing. Only faults a retry could plausibly fix return 500.
- **Jobs**: a job may declare an idempotency key for its window (`dailyKey`,
  `weeklyKey`); the unique index on `job_runs (job_name, idempotency_key)` makes
  a second invocation in the same window a no-op rather than a second round of
  emails.
- **Alerts**: suppression is a **content-addressed dedupe key**, not a timestamp
  comparison. `high_score:{id}:v{version}` re-fires on material update but never
  twice for the same version. `deadline:{id}:{date}:{interval}` includes the
  deadline, so a rescheduled deadline reconciles cleanly.

Alert jobs **insert the notification row before sending the email** and skip on
conflict, so a crash between insert and send loses an email rather than sending
two. That ordering is intentional — do not swap it.

---

## 8. Testing

`npm test` covers the places where a quiet mistake costs money or leaks paid
content: score arithmetic and classification bands, subscription-status
resolution including the past-due grace window, entitlement decisions per tier,
**MRR arithmetic across billing intervals**, alert matching and suppression keys,
deadline lifecycle transitions, CSV escaping and formula-injection defence,
filter parsing, **the sample-data exclusion**, **upgrade-source attribution**,
file signature sniffing and the virus scanner (including its HTTP failure
modes), the generated schedules, the legal document set, the design palette, and
unsubscribe token signing and tampering.

Add a unit test whenever you touch money, access, alerts, lifecycle transitions,
file handling or export escaping. Playwright runs against desktop Chrome,
iPhone 14, Pixel 7 and iPad; `tests/e2e` is excluded from `tsconfig` and from
Vitest.

---

## 9. Conventions, gotchas and deliberate choices

**Formatting.** Prettier: semicolons, single quotes, trailing commas, 80 columns,
2-space indent, with `prettier-plugin-tailwindcss`. TypeScript is `strict` with
`noUncheckedIndexedAccess` — indexing an array gives you `T | undefined` and you
must handle it. Unused variables are an ESLint **error** unless prefixed `_`.

**Comments.** This codebase documents _why_, not _what_, and often records the
alternative that was rejected. Match that register: when you make a non-obvious
call, write the reason and the cost. Do not add restating comments.

**Data honesty — several behaviours exist to stop the product overstating what it
knows. Do not "clean these up":**

- **Unknown is not zero.** An unresearched capital requirement scores 5
  (neutral), not 0, and a capital-ceiling filter does not exclude records whose
  requirement is unknown.
- **Ranges stay ranges.** `formatMoneyRange` renders "$250,000 – $400,000", never
  a midpoint, because a midpoint implies precision we do not have.
- **Coordinates are absent rather than estimated.** Approximate county-seat
  coordinates are loaded for the launch counties and labelled as suitable for
  centring a map, never for a distance presented as precise. The rest stay
  `NULL` until a verified centroid dataset is imported — no interpolation.
- **Sample data is flagged** via `is_sample`, badged, carried into exports, and
  kept out of the subscriber count, MRR, failed-payment tile and analytics
  aggregate (`src/lib/analytics/sample-data.ts`). Note the one deliberate
  exception: the `reports_read` policy lets `is_sample = true` bypass the rank
  check so a demo report displays at every tier. That is intentional.
- **MRR is computed in annualised integer cents** (`src/lib/billing/mrr.ts`) and
  divides by twelve exactly once, at the end. An unrecognised `billing_interval`
  is read as monthly and **counted in `unresolvedIntervals`** rather than
  silently folded in. Do not reintroduce a per-row division, and do not sum
  `monthly_price` regardless of interval — that was the original bug.
- **`sources.automation_allowed` cannot be set** without a recorded permissive
  `scraping_review_status` — a table constraint, not a policy document.

**Things that deliberately fail open**, each for a stated reason. If you touch
one, keep the behaviour or argue the change explicitly:

- The rate limiter (a DB hiccup must not lock everyone out of search).
- The admin MFA gate (a Supabase outage must not be indistinguishable from a
  missing second factor; RLS still enforces every permission underneath).
- `parsePlanFeatures` falls back field-by-field to compiled defaults, so an
  unknown key is ignored rather than crashing the request.

**The attachment scanner fails closed, which is the opposite choice and the
right one.** Members see only `clean` and `skipped`; anything `pending` or
`infected` is withheld. A scanner that cannot be reached does not quietly pass
the file.

**Two-factor is a gate, not a sign-in step.** It is enforced on entry to the
admin area, because a staff member is also a member and must not be locked out
mid-setup. `/admin/security` is exempt from its own gate or enrolment sits behind
a redirect loop; the layout learns its route from the `x-ledger-pathname` header
that `middleware.ts` sets, because a Next.js layout is not otherwise told.

**Unsubscribe works without a login, by design.** An unsubscribe link behind a
login is not an unsubscribe link — people mark the mail as spam instead, which
costs the sending domain's deliverability. The HMAC token carries no secret,
cannot be forged, and only ever turns email _off_. Alert/deadline/weekly mail
carries RFC 8058 `List-Unsubscribe` headers; account and billing mail
deliberately does not, because a failed-payment notice is not marketing.

**No vendor SDKs for Sentry or PostHog.** Both are implemented against the HTTP
API. PostHog events are captured **server-side from the same scrubbed payload**
that goes into `analytics_events`, so an ad blocker cannot drop a
`subscription_purchased` event and a client bug cannot leak member text to a
third party. The general rule: reach for an SDK when it does something genuinely
hard — posting JSON is not that.

**PDFs are written by hand** (`src/lib/reports/pdf.ts`), emitting valid PDF 1.4
with standard Helvetica fonts, rather than driving headless Chromium into the
serverless bundle. Complex layout is therefore not available; if that is needed,
the answer is a rendering service, not a bigger writer.

**`src/lib/db/types.ts` is intentionally loose.** Hand-maintaining a schema type
across thirty-odd tables produces something confidently wrong the first time a
migration lands. Regenerate with `npm run db:types` against a migrated database.

**Not built** — `docs/MILESTONES.md` is the maintained accounting and wins over
this list. The headlines: legal review of the ten documents in
`src/lib/legal/documents.ts` (a hard launch blocker — seven render an "awaiting
legal review" banner, and whether the other three are genuinely exempt is itself
an open question); a virus scanner **endpoint in production** (the pipeline,
provider interface, signature sniffing and retry job are all built and tested —
what is missing is a running scanner to point at); high-fidelity design
sign-off; and the tier-by-tier test-payment matrix.

**`upgrade_button_clicked` is declared in `lib/analytics/events.ts` and has never
fired.** `lib/analytics/upgrade-source.ts` exists to give it a typed origin, and
is tested, but the call sites are still not wired. Do not cite upgrade-funnel
data until they are — the event has no history.

---

## 10. Two agents work in this repository

**Torque** is operations — daily brief, inbox intake, cash review, opportunity
scan, follow-up, site monitor. Its protocol is below, its record is `docs/ops/`,
and its routines are `.claude/commands/dd84-*`.

**Rev** is marketing and revenue — growth discovery, offers, campaigns, funnel
and storefront work. Its spec is `docs/DD84-GROWTH-AGENT.md`, its definition is
`.claude/agents/rev.md`, its verified business context is
`docs/agents/ventures.md`, and its record is `docs/growth/`.

They were built independently, on separate branches of a different repository,
each unaware of the other; merged 2026-08-13; and moved here on 2026-09-09 when
this repository was confirmed as the canonical home. Three rules follow, and all
three are easy to undo by accident:

- **One repository.** `tune-advisor-` is retired. Do not take application code
  from it and do not revive its branch.
- **Two ledgers, still separate.** `docs/ops/` is what was operated,
  `docs/growth/` is what was proposed. Read across them freely; never write
  across them. Merging them loses exactly the distinction that makes either
  useful.
- **One schedule, Torque's.** Four Routines: inbox intake and daily brief on
  weekdays, cash review on Fridays, Georgia opportunity scan on Mondays. Rev has
  none — its weekly brief was retired as duplicative, and Rev runs on demand
  (`@rev`, `/rev-discovery`, `/rev-daily-brief`).
  **Those Routines have never once committed a brief** — see `docs/ops/` T-27
  and approval A-10 before treating the cadence as coverage. The cause is known:
  the fired sessions are created with no repository attached.

Both agents stop at an approval gate before anything that spends money,
publishes, or reaches a customer.

### Torque — the DD84 operating protocol for agents

`docs/DD84-OPERATIONS-AGENT.md` is the full owner-approved specification.
**Torque** is the operations execution agent it defines: precise, dependable,
technical, action-oriented — an experienced shop foreman who plans every job,
confirms approval, creates the necessary tasks, then executes them in the correct
order. Voice: clear, efficient, practical, detail-focused.

The operating sequence is:

> **DISCOVER → VALIDATE → ORGANIZE → PLAN → GET APPROVAL → EXECUTE → VERIFY →
> DOCUMENT → FOLLOW UP**

What this means concretely when working in this repository:

- **Automatic without being uncontrolled.** Research, analysis, planning, task
  creation, drafting, local edits, running tests and preparing changes need no
  approval. Crossing an approval boundary does.
- **Approval boundaries that apply here** (classes C–G of the spec): sending
  customer or external communication, publishing, changing live pricing, any
  financial action, and **changing production websites, accounts, integrations,
  permissions or customer data**. In practice: opening or merging a PR, pushing
  to `main`, touching production Supabase or Stripe, and running the seeder
  anywhere but locally.
- **Never stop at a recommendation once approved.** If approval is given and the
  tools can do the work, do the work. If a tool or permission blocks you, say
  exactly what was not completed and hand back the smallest manual action
  package that finishes it — clearly marked as not executed.
- **Verify in the destination, do not assume the tool succeeded.** For code that
  means running `typecheck`, `lint` and `test` and reporting the actual output.
- **Never fabricate** completion, confirmations, approvals, test results, file
  states or links. "Uncertain completion" stays _in verification_, not
  _complete_, until there is objective evidence.
- **Do not silently expand scope.** Any cost, risk, deadline or customer-facing
  variance goes back for approval.
- **Protect secrets and proprietary material.** Credentials, customer data,
  tune files, bench pinouts and internal technical procedures never go into
  public content, commit messages, PR bodies or artifacts.

When an approval is genuinely needed, use the spec's packet format rather than a
vague question: decision requested · business objective · source and context ·
recommended plan · alternatives · cost and cash impact · risks and safeguards ·
systems affected · customer/public impact · success test · **APPROVE / APPROVE
WITH CHANGES / DEFER / REJECT**.

### Where the protocol actually runs

**`.claude/commands/dd84-*.md`** — the six routines from spec §16, as invocable
slash commands. Each states its objective, the exact connectors and tools it
reads, its output format, where it writes, what it may never do without
approval, and what it does when a connector is missing. All six are Class A:
they observe, calculate, draft and report, and **none of them sends, publishes,
charges or changes a live system** — which is precisely what makes them safe to
run unattended.

| Command                  | Purpose                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `/dd84-daily-brief`      | Appointments, money moved, overdue work, risks, decisions  |
| `/dd84-inbox-intake`     | Email into leads, tasks and drafts — drafts only           |
| `/dd84-followup`         | Quotes, deposits, waiting customers, reviews, referrals    |
| `/dd84-cash-review`      | Revenue, pipeline, receivables, margin, upcoming spend     |
| `/dd84-opportunity-scan` | Find, validate, score and rank Georgia opportunities       |
| `/dd84-site-monitor`     | Pages, forms, uploads, products, payment links, fulfilment |

**`docs/ops/`** — the operating record, where those routines write and where
operational state survives the end of a session. `TASK-REGISTER.md` is the live
register of work; `APPROVALS.md` is every packet with its response, limits and
actual result; `OPERATING-LOG.md` is the append-only execution log; `briefs/`
holds dated routine output. `docs/ops/README.md` carries the routine contract.

Two rules from that directory are worth stating here, because they are the ones
most easily lost. **A task is Done only when the operating log carries
evidence** — otherwise it is In Verification. And **a missing connector degrades
a section to "not available this run"; it never becomes an estimate.** Both are
the same principle the data-honesty rules in §9 apply to the product: unknown is
not zero, and a number without a source is a defect.

---

## 11. Git

The default branch is `main`. Develop on a branch and push with
`git push -u origin <branch>`. **Pushing to `main` is an approval boundary**
(§10), as is opening a pull request — do not do either unless asked. Commit
messages describe what changed and why, in the same plain register as the code
comments.
