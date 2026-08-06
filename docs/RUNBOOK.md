# Runbook

Operational procedures and the production launch checklist.

---

## Environment setup

Each environment needs its own values for every key in `.env.example`. Nothing
is shared between development, staging and production — not the database, not
the Stripe keys, not the storage buckets, not the analytics project.

### Database

```bash
supabase link --project-ref <ref>
supabase db push                     # applies migrations in order
psql "$DATABASE_URL" -f supabase/seed.sql   # reference data only
```

`supabase/seed.sql` is idempotent: plans, states, counties, cities, industries,
sources and indicator definitions all upsert on a natural key. It contains no
demo users and no sample records — those come from `npm run db:seed`, which
refuses to run against production.

### Stripe

Run the setup script once per environment. It creates the four products and the
six paid prices (spec 6: $15/$150, $39/$390, $99/$990), then writes the ids onto
`subscription_plans`:

```bash
STRIPE_SECRET_KEY=sk_test_... npm run stripe:setup   # test catalogue
STRIPE_SECRET_KEY=sk_live_... npm run stripe:setup   # live catalogue
```

The mode is decided entirely by the key. Products are matched on
`metadata.plan_code` and prices on their lookup key (`gol_weekly_monthly` and so
on), so running it twice changes nothing. Prices are immutable in Stripe: if an
amount in the script disagrees with an existing price, the script says so and
leaves it alone — changing what a current subscriber pays is a deliberate
migration, not a setup step.

No price id is committed to this repository. An id is only meaningful in the
mode that minted it, and hardcoding one guarantees that somebody eventually
points a live key at a test price.

The checkout endpoint returns a clear conflict rather than failing inside Stripe
when a price id is missing, so this is safe to verify by trying it.

Two things the script cannot do for you:

- Add the webhook endpoint `POST /api/v1/webhooks/stripe`, subscribed to
  `checkout.session.completed`,
  `customer.subscription.created|updated|deleted` and
  `invoice.payment_failed`. Put the signing secret in `STRIPE_WEBHOOK_SECRET`.
- Pin the API version on the Stripe account. The client deliberately does not
  pin one in code, so upgrading is a deliberate dashboard action with a
  test-mode rehearsal rather than a side effect of a dependency bump.

### Virus scanning

Uploads are scanned before members can reach them. With no scanner configured
files store as `scan_status = 'skipped'`, which is readable — and which logs a
warning on every upload in production, because shipping without one is a
decision somebody should have made on purpose.

To turn scanning on, run a ClamAV REST front end and point `FILE_SCANNER_URL`
at it:

```bash
docker run -d -p 9000:9000 --name clamav-rest clamav/clamav-rest
# then, in the environment:
FILE_SCANNER_PROVIDER="clamav"
FILE_SCANNER_URL="http://clamav-rest:9000/scan"
```

Verify it end to end with the EICAR test string — a harmless file every scanner
recognises. Upload it through `/admin/opportunities/{id}` and the endpoint
should refuse it, the object should be gone from the bucket, and the row should
read `infected` with the signature name in `scan_detail`.

If the host cannot reach `database.clamav.net` for signature definitions, the
client can still be verified against a real engine using a custom signature:

```bash
mkdir -p /tmp/clamdb
python3 -c "s=open('/tmp/eicar.com').read(); \
  open('/tmp/clamdb/eicar.ndb','w').write('EICAR-Test:0:*:'+s.encode().hex())"
clamscan -d /tmp/clamdb --no-summary /tmp/eicar.com   # ... FOUND
```

`tests/unit/files/scanner-http.test.ts` covers the same contract without any
engine at all, so the client is checked on every push regardless.

### Background jobs

The fourteen schedules live in `src/lib/jobs/registry.ts`. Both platforms'
config is generated from it:

```bash
npm run schedules:generate   # rewrite vercel.json and netlify/functions
npm run schedules:check      # fail if either has drifted (runs in CI)
```

**On Netlify** each job is a scheduled function in `netlify/functions`. Netlify
has no equivalent of Vercel Cron's automatic credential, so each function sends
`CRON_SECRET` as a bearer token itself. Set `CRON_SECRET`; `URL` is provided by
Netlify.

**On Vercel** `vercel.json` declares the crons and Vercel attaches
`CRON_SECRET` automatically when the variable is present. Jobs accept both
`GET` (what Vercel Cron sends) and `POST`.

The endpoint authorises on the header rather than on who is calling, so it is
identical either way.

### The one thing that does not port

`/api/v1/jobs/[job]` declares `maxDuration = 300` and
`/api/v1/admin/attachments` declares `60`. Vercel reads those exports; Netlify
does not, and its synchronous function limit is well below 300 seconds on every
plan. Long jobs — `distribute-weekly-report` and `process-exports` especially —
will be cut off mid-run on Netlify unless one of these applies:

- run them as Netlify **background functions**, which raises the ceiling to 15
  minutes (paid plans);
- or leave the schedule to an external caller (Supabase `pg_cron`, GitHub
  Actions, any uptime pinger) hitting `/api/v1/jobs/{job}` with the bearer
  token, and delete the scheduled functions.

Every job writes a `job_runs` row before it starts and updates it at the end, so
a truncated run is visible on the admin dashboard as one that began and never
finished, rather than as silence.

To run one by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://<host>/api/v1/jobs/evaluate-deadlines
```

Available jobs: `publish-scheduled`, `premium-alerts`, `saved-search-matching`,
`process-exports`, `evaluate-deadlines`, `deadline-reminders`,
`reverification-reminders`, `stale-source-reminders`, `expire-lapsed-access`,
`sync-subscriptions`, `aggregate-analytics`, `prune`, `scan-attachments`,
`distribute-weekly-report`.

---

## Operational procedures

### A staff member has lost their authenticator

They are locked out of the admin area, not out of their account — they can still
use the member side normally.

A super administrator clears the enrolment from `/admin/staff`, then the person
re-enrols at `/admin/security`. Three rules are enforced, not conventions:

- Only a super administrator can do it. A support representative can read member
  accounts, which is exactly the position from which resetting someone else's
  second factor would be most useful to an attacker.
- Nobody can reset their own. A reset is a recovery path and needs a second
  person; otherwise a session that got past the password alone could shed the
  factor it could not present.
- The reason is mandatory and lands on the audit row with both names and the
  factors removed.

**Confirm their identity by a channel other than email** before you clear
anything. Email is one of the things the second factor exists to protect, so a
request arriving by email proves only that someone can send email.

If every super administrator is locked out at once, the fallback is still
Supabase directly (Auth → the user → MFA factors). That path is unaudited, which
is why it is the fallback.

### An attachment is not visible to members

Check `scan_status` on the row. Members see only `clean` and `skipped`; the read
policy withholds `pending`, `scanning`, `failed` and `infected`, so an
attachment that "disappeared" is almost always one whose scan has not resolved.

- `pending` or `scanning` — `scan-attachments` runs every twenty minutes and
  will pick it up. A row stuck in `scanning` for over fifteen minutes had its
  process killed and is reclaimed on the next run.
- `failed` — `scan_detail` says why. A scanner outage is the usual cause; the
  job retries up to five times, then leaves it for a person.
- `infected` — the file was deleted from storage on purpose. The row is kept so
  the incident is on the record. Do not clear the status to make it downloadable
  again; there is nothing left to download.

Files whose attempts are exhausted are counted in the job's `detail.exhausted`
on the admin dashboard.

### A member reports missing access after paying

1. Check `subscriptions` for their `status` and `current_period_end`.
2. Check `billing_events` for unprocessed rows — `processed = false` with a
   `processing_error` means a webhook failed.
3. Run `sync-subscriptions` to reconcile against Stripe directly. This is the
   designed remedy for a missed webhook and is safe to run at any time.
4. If they need access immediately while you investigate, a super administrator
   can set `access_rank_override` with an expiry. It is audited.

### A record was published in error

Move it to `internal_review` through
`POST /api/v1/admin/opportunities/{id}/submit-review`, which clears
`published_at` and writes an `opportunity.unpublished` audit entry. Do not
delete it: deletion loses the version history and the audit trail is what makes
the correction defensible.

For a record that must be withheld from everyone regardless of tier — a source
dispute, a pending correction — set `is_restricted = true` with a
`restriction_reason`. The database requires the reason.

### Alerts did not fire

Every declined alert records a machine-readable reason. Check the `job_runs`
row's `detail` for the run, then reason through
`src/lib/alerts/matching.ts`: the common causes are
`insufficient_access_rank` (the record is above their plan),
`not_entitled` (immediate alerts are Premium-only),
`deadline_unverified` (we do not push people toward unconfirmed deadlines), and
`already_sent` (the dedupe key was claimed).

### An export is stuck

Exports above 500 rows are queued for `process-exports`. Check `export_jobs` for
`status` and `error_message`. Files live under a per-user prefix in the
`exports` bucket, are served through short-lived signed URLs, and expire after
seven days — `prune` marks them expired.

### Rate limiting is too aggressive

Limits are in `RATE_LIMITS` in `src/lib/http/rate-limit.ts`. The limiter fails
open on database errors and logs when it does, so a spike in
`[rate-limit] check failed` means the limiter is not limiting, not that members
are locked out.

---

## Production launch checklist

Spec 28, milestone 10. Every line needs a name against it.

**Run it rather than read it:**

```bash
npm run preflight              # against the production environment
npm run preflight -- --json    # machine-readable
```

Most of what follows is now decided by that command instead of by someone
walking the list and deciding for themselves. It reports four states, and the
third is the one that matters:

|        |                                                           |
| ------ | --------------------------------------------------------- |
| `ok`   | checked, and it is right                                  |
| `FAIL` | checked, and it is wrong                                  |
| `??`   | **could not check** — counts as not ready, never as ready |
| `you`  | no machine can decide this; it is owner work              |

`??` exists because this codebase has twice shipped a check that passed by
looking at nothing — `smoke.sh` reporting "nothing sensitive is advertised"
against a server that was not running, and a guard grepping an empty checkout.
A readiness report that cannot tell "fine" from "did not look" is worse than
none, because it gets believed. Anything the command cannot reach from where it
runs is reported as unknown and keeps the exit status non-zero.

It exits 0 only when every blocking item passes, owner work included — so a
green run is the launch gate, not a suggestion.

Which of the lines below it decides for you is not duplicated here, because a
second list would drift from the first: run the command and read the states. It
covers configuration, the legal-review flags, the database questions (sample
data, price ids, super administrators, staff two-factor), the scanner against a
real EICAR upload, sending-domain DNS, and the deployed `robots.txt` and
sitemap. What it marks `you` is what no machine can close.

### Blocking

- [ ] **Legal review of the nine documents marked `requiresReview`** in
      `src/lib/legal/documents.ts`. Each renders an "awaiting legal review"
      banner until cleared. This is the hard blocker. The other three —
      editorial standards, corrections, data sources — state our own practice
      and do not need counsel; the split is pinned in
      `tests/unit/legal/documents.test.ts`.
- [ ] Stripe live mode: `npm run stripe:setup` with the live key, then the
      webhook endpoint. Confirm `subscription_plans` carries all six price ids.
- [ ] Tier-by-tier test payment verifying each plan grants the correct access
      (spec 28, milestone 3 acceptance).
- [ ] Email domain authentication: SPF, DKIM and DMARC on the sending domain.
- [ ] Database backups enabled with point-in-time recovery.
- [ ] Administrator multi-factor enrolment for every staff account. The gate is
      enforced in code; each person still has to enrol at `/admin/security`.
- [ ] `EMAIL_UNSUBSCRIBE_SECRET` set to its own value, not falling back to
      `CRON_SECRET`. Rotating one must not invalidate every unsubscribe link
      already sitting in inboxes.
- [ ] Verify one-click unsubscribe end to end: the `List-Unsubscribe` header is
      present, and the link works while signed out.
- [ ] Security review: the test list in spec 26 — unauthorised API access,
      access-rank bypass, direct URL access, ID enumeration, invalid webhooks,
      file-upload attacks, XSS, SQL injection, rate-limit enforcement.
- [ ] `FILE_SCANNER_URL` set and verified with the EICAR test file. Without it
      every attachment stores as `skipped` — readable, and unscanned.
- [ ] At least two super administrators enrolled, so a lost authenticator has an
      in-product recovery path rather than a Supabase one.
- [ ] Confirm no sample data reached production:
      `select count(*) from opportunities where is_sample;` must be 0.

### Required before opening to customers

- [ ] Domain connected with Cloudflare in front.
- [ ] Sentry DSN configured and an error verified end to end.
- [ ] PostHog configured and the subscription funnel verified.
- [ ] Cron schedules confirmed firing; check `job_runs` after 24 hours.
- [ ] A real weekly report published, emailed, and read at each tier.
- [ ] Administrator training on the review queue and correction workflow.
- [ ] Accessibility audit against WCAG 2.1 AA. `docs/ACCESSIBILITY-AUDIT.md`
      is the brief; the automated third already runs on every push.
- [ ] Core Web Vitals measured on the public pages. The landing pages are
      prerendered with `revalidate` windows; confirm the cache is actually being
      hit rather than every request revalidating.

### Verify after launch

- [ ] `robots.ts` serves the production ruleset (it blocks everything outside
      production, so a misconfigured `NEXT_PUBLIC_ENVIRONMENT` silently
      de-indexes the site).
- [ ] Sitemap reachable and county pages indexed.
- [ ] A cancellation end to end: access continues to period end, then drops.
- [ ] A failed payment end to end: grace window, then downgrade, with saved
      records intact.

---

## Continuous integration

`.github/workflows/ci.yml` runs four jobs on every push:

| Job          | What it proves                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `static`     | Types, lint, formatting, 177 unit tests                                                                       |
| `migrations` | Every migration applies in order from an empty Postgres, and the reference seed is idempotent (it runs twice) |
| `build`      | A production build succeeds                                                                                   |
| `e2e`        | The security and accessibility suites against a built app                                                     |

The `e2e` job has no database, so the checks that need one skip with a stated
reason rather than passing. That is deliberate: a suite that read a 500 as "the
endpoint refused me" would report a green tick for an access boundary it never
exercised. To run those for real, point `E2E_BASE_URL` at an environment with
migrations applied and `npm run db:seed` loaded.

```bash
E2E_BASE_URL=https://staging.example.com npm run test:e2e:security
./scripts/smoke.sh https://staging.example.com
```

### Checking the database itself

```bash
npm run db:verify                        # throwaway cluster, torn down after
./scripts/verify-schema.sh "$DATABASE_URL"   # an existing database
```

The first form needs nothing but `initdb` and `psql` on PATH — no Docker, no
Supabase CLI. It starts its own PostgreSQL instance, applies all 26 migrations
in order from empty, loads the reference data twice to prove the idempotence
claim, runs the row-level-security checks, and removes the cluster. It is the
same script CI runs, so the two cannot drift.

The second form runs only the assertions against a database that already has
the migrations. It writes fixtures and rolls them back, so do not aim it at
production.

`supabase/verify-rls.sql` asserts what the architecture claims: that a member
at each tier sees exactly the records their rank allows, that role and
account-status changes are refused without a super administrator, that the
functions only the service role should call are not reachable by `anon` or
`authenticated`, and that every table has row-level security on.

`supabase/ci-bootstrap.sql` creates stand-ins for the objects Supabase provides
(`auth.users`, `auth.uid()`, the storage tables, the API-role grants) so the
migrations can be applied to a bare PostgreSQL instance. It is for CI and local
checking only; never run it against a real Supabase project.

`scripts/smoke.sh` needs no credentials and is safe to run against production at
any time. It checks that the public pages answer, the access boundary holds, the
jobs refuse without their secret, and the sitemap advertises nothing private.

It aborts with exit 2 if the host does not answer at all, rather than running
the checks anyway. That is not defensive padding: the first version reported
"ok — nothing sensitive is advertised" against a server that was not running,
because `curl` returned nothing and `grep` found nothing in the nothing. Exit 1
means a real failure; exit 2 means it could not look.

---

## Things that will bite

- **`NEXT_PUBLIC_ENVIRONMENT` controls more than a banner.** It gates indexing
  and the seeder's production refusal. Set it correctly per environment.
- **The service-role key bypasses row-level security entirely.** It belongs only
  in the webhook handler, the jobs and the seeder. Anything acting on behalf of
  a signed-in member must use `createServerSupabaseClient()`.
- **`getUser()`, not `getSession()`.** The former validates the token with the
  auth server; the latter trusts the cookie. On pages that decide what paid
  content to render, that difference matters.
- **Public pages must use the anonymous client.** `src/lib/db/public.ts`, not
  `createServerSupabaseClient()`. The session client reads cookies, which makes
  the whole route render per request. A `try/catch` around such a read will also
  swallow Next.js's dynamic-bailout signal — that bug produced a silently empty
  homepage once already.
- **A production build now fails if it cannot read the database.** That is
  deliberate: the landing pages are prerendered, so a build that cannot read
  would bake an empty home page and serve it for the whole revalidate window.
  A failed deploy is the cheaper outcome. Local builds without Supabase still
  pass, with the failures logged.
- **`scan_status = 'skipped'` is downloadable.** It means no scanner is
  configured, not that a file was checked and cleared. That is a deployment
  decision with a line on the checklist above, not a per-file verdict.
- **Prices are immutable in Stripe.** Changing an amount means minting a new
  price and migrating subscribers onto it. `stripe:setup` will not do that for
  you, and should not.
- **`next build` caches prerenders.** A source change that does not appear in
  the output is usually a stale `.next`, not a broken edit. `rm -rf .next`
  before concluding anything about prerendered HTML.
- **`text-ink-400` is not safe for body copy.** 3.7:1 on white, below the AA
  floor. `ink-500` is the lightest token that passes; the ladder is documented
  in `tailwind.config.ts` and the accessibility suite catches regressions.
- **Revoking from `PUBLIC` is not enough.** Supabase's default privileges grant
  EXECUTE on every new function to `anon` and `authenticated` _by name_, and
  PostgREST exposes anything `authenticated` may execute as
  `POST /rest/v1/rpc/<name>`. A new SECURITY DEFINER function is reachable by
  every signed-in member the moment it is created unless migration 0024's list
  is extended. `verify-rls.sql` fails if one is missed.
- **The plan matrix lives in two places.** Changing a limit means changing both
  `subscription_plans.feature_configuration` and `PLAN_FEATURE_DEFAULTS`.
  `tests/unit/access/plan-parity.test.ts` fails if you forget.
