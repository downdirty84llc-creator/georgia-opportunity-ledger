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

1. Create four products matching the plan codes: `free`, `weekly`, `detailed`,
   `premium`.
2. Create monthly and annual prices for the three paid plans (spec 6:
   $15/$150, $39/$390, $99/$990).
3. Write the price ids onto `subscription_plans`:

   ```sql
   update public.subscription_plans
   set stripe_monthly_price_id = 'price_...',
       stripe_annual_price_id  = 'price_...'
   where code = 'weekly';
   ```

   The checkout endpoint returns a clear conflict rather than failing inside
   Stripe when a price id is missing, so this step is safe to verify by trying it.

4. Add the webhook endpoint `POST /api/v1/webhooks/stripe` subscribed to
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`
   and `invoice.payment_failed`. Put the signing secret in
   `STRIPE_WEBHOOK_SECRET`.

5. Pin the API version on the Stripe account. The client deliberately does not
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

### Background jobs

`vercel.json` declares all fourteen cron schedules. Set `CRON_SECRET`; Vercel
sends it automatically as a bearer token when the variable is present. Jobs
accept both `GET` (what Vercel Cron sends) and `POST`.

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

### Blocking

- [ ] **Legal review of all twelve documents** in `src/lib/legal/documents.ts`.
      Each is marked `requiresReview: true` and renders an "awaiting legal
      review" banner until cleared. This is the hard blocker.
- [ ] Stripe live mode: products, prices, webhook endpoint, price ids written to
      `subscription_plans`.
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
- [ ] Accessibility audit against WCAG 2.1 AA.
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
- **The plan matrix lives in two places.** Changing a limit means changing both
  `subscription_plans.feature_configuration` and `PLAN_FEATURE_DEFAULTS`.
  `tests/unit/access/plan-parity.test.ts` fails if you forget.
