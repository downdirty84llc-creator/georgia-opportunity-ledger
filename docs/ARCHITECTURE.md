# Architecture

Why the system is shaped the way it is. Decisions that were close calls are
recorded with the reasoning, so a future change can disagree on purpose rather
than by accident.

---

## 1. The central problem: column-level access control

The product needs three different answers for the same record:

- A signed-out visitor should see that it exists, and its score.
- A Weekly member should see the summary and the financial overview.
- A Detailed member should see the analysis, the score explanation and the risk
  factors.

PostgreSQL's row-level security is row-level. It can hide a row; it cannot hide
a column. Three options were considered:

1. **Relax RLS and redact in the application.** Rejected. The anon key is public
   by design, so anything RLS admits is reachable by hitting PostgREST directly.
   The redaction would be advisory.
2. **Route everything through the Next.js API with the service-role key.**
   Rejected. It works, but it makes every handler individually responsible for
   the entire access model, with no backstop when one forgets.
3. **A `SECURITY DEFINER` set-returning function.** Chosen.
   `public.search_opportunities` (migration 0021) applies the filters, compares
   `public.my_access_rank()` against each row's `minimum_access_rank`, and
   returns `NULL` for columns above the caller's tier. A caller hitting the RPC
   directly with the anon key receives exactly what the application would have
   shown them.

Teasers for records a member cannot open come from `public.opportunity_previews`
(migration 0019), a deliberately narrow view carrying no analysis, financial,
eligibility or source-URL fields. There is nothing in it to leak.

The rule is then implemented a second time in TypeScript (`src/lib/access`), not
for security but for **messaging**: the API can answer 402 with the specific
plan that unlocks the record, which is what spec 14.3 requires and what a bare
RLS denial cannot express.

---

## 2. Three layers of enforcement

| Layer | Enforces | Fails safe by |
| --- | --- | --- |
| Row-level security | Which rows exist for this key | Returning nothing |
| `search_opportunities` | Which columns this rank may read | Returning NULL |
| `src/lib/access` | Which capabilities this plan includes | Returning a decision with a reason |

A bug in any one is caught by the others. The cost is that the plan matrix
exists twice — in `subscription_plans.feature_configuration` and in
`PLAN_FEATURE_DEFAULTS` — so `tests/unit/access/plan-parity.test.ts` diffs the
compiled table against `supabase/seed.sql` on every run.

---

## 3. Subscription status and the grace window

`effectiveAccessRank` is the single answer to "what may this account read". It
folds together:

- **Account status.** Suspended or closed drops to rank 0 immediately, including
  for staff. A suspended editor previews nothing.
- **Role.** Staff resolve to rank 100 so they can preview every tier. Staff
  *permissions* — publish, refund, suspend — are role checks and never rank
  checks, because "Premium member" must never imply "administrator".
- **Subscription.** Active and trialing grant the plan rank. Cancelled keeps
  access to the period end, because it has been paid for. Past-due keeps access
  through the period plus a **three-day grace window**: Stripe's smart retries
  run for about a week, and cutting a paying customer off on the first failed
  charge generates support load out of all proportion to the revenue at risk.
- **Override.** A super administrator can grant a temporary rank. It only ever
  raises, never lowers, and every write is audited.

`cancel_at_period_end` deliberately does **not** reduce access. The member has
paid through the period; taking capability away early would break the promise in
spec 9 and would be the wrong side of the argument in a chargeback.

---

## 4. Idempotency

Three separate mechanisms, because three different things can double-fire.

**Stripe webhooks** — the insert into `billing_events` is the lock. Its unique
`stripe_event_id` means a retry conflicts and is acknowledged without
reprocessing. Only faults a retry could plausibly fix return 500.

**Background jobs** — a job may declare an idempotency key for the window it
covers (`dailyKey`, `weeklyKey`). The unique index on
`job_runs (job_name, idempotency_key)` makes a second invocation in the same
window a no-op rather than a second round of emails.

**Alerts** — suppression is a content-addressed dedupe key, not a timestamp
comparison. `high_score:{id}:v{version}` fires again when a record is materially
updated but never twice for the same version. `deadline:{id}:{date}:{interval}`
includes the deadline itself, so a rescheduled deadline reconciles cleanly: the
new date produces a new key and the member is reminded again, while an unchanged
date never re-fires.

The alert jobs insert the notification row **before** sending the email, and
skip on conflict. A crash between insert and send therefore loses an email
rather than sending two — the right way round for a product people pay to be
alerted by.

---

## 5. Search and pagination

Eight sort orders (spec 11) would normally mean eight keyset-pagination
branches. Instead the search function computes one lexicographically orderable
`sort_key` per row — zero-padded numbers, `YYYYMMDDHH24MISS` timestamps,
lower-cased titles — so a single row-wise tuple comparison
`(sort_key, id) < (cursor_key, cursor_id)` implements the cursor for every sort.

Full-text search spans the record's own prose plus the denormalised names of its
county, city and industries. Because those live in other tables the vector is
maintained by trigger rather than as a generated column, with triggers on
`opportunities`, `opportunity_industries` and `funding_details`.

---

## 6. Rate limiting

The application runs on serverless functions, so an in-process counter would be
per-instance and effectively no limit at all. The counter lives in Postgres:
`public.check_rate_limit` performs one atomic upsert per request.

Windows are fixed rather than sliding. A fixed window can admit up to 2× the
limit across a boundary; that is an acceptable trade for a single indexed write,
and the limits are set with it in mind. The limiter **fails open** — a database
hiccup should not lock every member out of search — and logs when it does.

---

## 7. PDF generation

Report PDFs are produced by a small dependency-free writer
(`src/lib/reports/pdf.ts`) rather than by driving a headless browser. A weekly
report is structured text; shipping Chromium into the serverless bundle would
cost several hundred megabytes and a cold start measured in seconds for output
no better than this. The writer emits valid PDF 1.4 using the standard Helvetica
fonts, so nothing is embedded.

The trade-off is that complex layout — charts, multi-column, images — is not
available. If the product later needs those, a rendering service is the right
answer, not a bigger writer.

---

## 8. Editorial workflow

Separation of duties is enforced by the software (`src/lib/opportunities/workflow.ts`),
not by convention:

- A **researcher** drafts and submits, and cannot publish, score, or change who
  may see a record.
- A **reviewer** approves, returns with notes, and sets component scores.
- An **editor** publishes.

Nobody can carry a record from draft to publication alone. `workflow_status` is
deliberately **not** accepted by the content PATCH endpoint — otherwise a
researcher could publish by PATCHing a field they are allowed to edit. Workflow
moves live on dedicated action endpoints that re-check the role.

`missingPublishFields` blocks publication of a record lacking the analysis a
subscriber is paying for, at the API rather than only in the form, so a record
published through a script cannot skip it.

---

## 9. The audit log

`audit_logs` is append-only. There is no update or delete policy — not for
editors, not for super administrators — so the trail cannot be rewritten from
any client key. Entries are written by `SECURITY DEFINER` triggers on publish,
unpublish, score change, access change, subscription override, suspension, role
change, and deletion.

`write_audit_log` is `SECURITY DEFINER`, and Postgres grants `EXECUTE` on such
functions to `PUBLIC` by default — which would let any signed-in member forge
entries. Execution is therefore revoked, and the application calls
`log_admin_action`, a guarded wrapper that checks `is_staff()` first.

---

## 10. Data honesty

Several choices exist to stop the product overstating what it knows:

- **Unknown is not zero.** An unresearched capital requirement scores 5
  (neutral), not 0, so a blank field is not indistinguishable from a genuinely
  capital-heavy deal. A capital ceiling filter does not exclude records whose
  requirement is unknown.
- **Ranges stay ranges.** `formatMoneyRange` renders "$250,000 – $400,000"
  rather than a midpoint, because a midpoint implies precision we do not have.
- **Coordinates are absent rather than estimated.** The seed loads county-seat
  coordinates only for the launch counties; the rest stay `NULL` until a
  verified centroid dataset is imported.
- **Sample data is flagged.** `is_sample` on profiles, opportunities, indicator
  values and reports, badged in the UI and carried into the CSV export.
- **Automation requires a terms review.** `sources.automation_allowed` cannot be
  set without a recorded permissive `scraping_review_status` — a table
  constraint, not a policy document.

---

## 11. Deliberate omissions

- **No PostGIS dependency.** The extension is created opportunistically and the
  schema degrades to a lat/long btree index if it is unavailable. Radius search
  is not implemented; bounding-box narrowing is supported.
- **No generated database types.** `src/lib/db/types.ts` is honestly loose with
  instructions to replace it via `npm run db:types` against a migrated database.
  Hand-maintaining a schema type across thirty-odd tables produces something
  confidently wrong the first time a migration lands.
- **No admin opportunity editor UI.** The multi-step editor described in spec
  15.2 is served by the API (`POST`/`PATCH /api/v1/admin/opportunities`) and the
  review queue; the seven-step form itself is not built.
- **No report builder UI.** Reports are created and published through the API;
  the drag-and-drop composer in spec 15.4 is not built.

---

## 12. Vendor integrations without vendor SDKs

Two integrations are implemented against the vendor's HTTP API rather than its
SDK, and the reasoning is the same in both cases.

**Sentry** (`src/lib/observability/report-error.ts`). `@sentry/nextjs` brings a
build plugin, source-map upload, an instrumentation hook and real bundle cost.
What the application needs is "post the exception somewhere I will see it", and
Sentry's envelope endpoint accepts exactly that. The cost is honest and stated
in the module: no breadcrumbs, no performance tracing, no release health, and
stack frames are not mapped back through the bundler. Swapping in the official
SDK later is a contained change, because nothing outside that module knows how
a report is delivered.

**PostHog** (`src/lib/analytics/posthog.ts`). Events are captured server-side
from the same scrubbed payload that goes into `analytics_events`, rather than
from the browser. Two advantages beyond bundle size: an ad blocker cannot
silently drop a `subscription_purchased` event, and a client-side bug cannot
leak member-entered text into a third-party store, because the only properties
that exist by that point have already been through `scrubProperties`.

The general rule: reach for the SDK when it does something genuinely hard.
Posting JSON is not that.

---

## 13. Unsubscribe that actually unsubscribes

An unsubscribe link behind a login is not an unsubscribe link. Someone who
cannot easily stop the email marks it as spam instead, which costs the sending
domain's deliverability for everybody.

`src/lib/email/unsubscribe.ts` mints an HMAC token over the user id and scope.
The token carries no secret, cannot be forged, and — importantly — only ever
turns email *off*. Possession of one grants no read access and enables nothing,
so the usual objection to unauthenticated action links does not apply.

Alert, deadline and weekly-report email carry `List-Unsubscribe` and
`List-Unsubscribe-Post` headers (RFC 8058), so a mail client can offer its own
unsubscribe button without the member leaving their inbox. Account and billing
email deliberately does not: a failed-payment notice is not marketing, and the
preference page says so plainly rather than implying it can be switched off.

---

## 14. Two-factor as a gate, not a sign-in step

Spec 3.3 requires administrator MFA. It is enforced when entering the admin
area rather than at sign-in, for two reasons: a staff member is also a member
and should not be locked out of their own dashboard mid-setup, and enrolment
needs somewhere to happen.

Supabase models this as an assurance level — `aal1` is "password verified",
`aal2` is "password plus a second factor this session". Holding an enrolled
factor is not the same as having used it, so `getMfaStatus` checks both and
distinguishes "enrol" from "present your code".

Two details worth knowing:

- The check **fails open** on an unexpected error. A Supabase outage should not
  be indistinguishable from a missing second factor, and row-level security
  still enforces every permission underneath — so the worst case is a
  password-only admin session during an outage, not unauthorised access.
- `/admin/security` is exempt from its own gate, or enrolment sits behind a
  redirect loop. The layout learns which route it is wrapping from a pathname
  header set in middleware, because a Next.js layout is not otherwise told.

---

## 15. Public pages and the caching boundary

`src/lib/db/public.ts` exists because of a subtle failure discovered during a
build: the marketing pages read only public teaser views, but they were doing so
through the *session-bound* client, which calls `cookies()`. That forces the
whole route to render per request, defeating the caching spec 23 asks for.

Worse, the `try/catch` in those loaders was swallowing Next.js's
`DynamicServerError` — the control-flow exception the framework throws to signal
"bail out of static generation". Catching a framework's control flow and
returning empty data is the kind of bug that produces a permanently blank
homepage without ever logging an error.

Public loaders now use an anonymous, cookie-free client. Every projection they
touch is already granted to `anon` and carries no paid content, so nothing is
weakened. `sitemap.xml` became genuinely static as a result.

The marketing pages themselves are still rendered per request, because the
shared header is session-aware. That is a real, known gap against spec 23 and is
recorded in `MILESTONES.md` rather than papered over.
