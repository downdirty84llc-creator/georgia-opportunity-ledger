# Working in this repository

## This repository is canonical. Use only this one.

`downdirty84llc-creator/georgia-opportunity-ledger` is the Georgia Opportunity
Ledger's only home. Push here and nowhere else.

**Do not push to `downdirty84llc-creator/tune-advisor-`.** That repository holds
the DD84 automotive tuning business, which is a different company. It also still
carries a stale copy of this codebase as its default branch, for the historical
reason that the Ledger was originally built there and GitHub will not let a
default branch be deleted. That copy is not to be updated.

If `git remote -v` shows `tune-advisor-`, the remote is wrong — a container
reset has reverted it. Fix it:

```bash
git remote set-url origin https://github.com/downdirty84llc-creator/georgia-opportunity-ledger.git
```

This has happened repeatedly. If a stop hook reports unpushed commits, check
which remote `origin` points at **before** pushing to satisfy it.

## Work directly on `main`

The owner authorised this on 2026-09-22, replacing the earlier arrangement of
committing to `claude/georgia-opportunity-ledger-kfpt4c` and merging on
request. That branch was merged into `main` at `3cedc5e` and the two are
identical; it is spent.

Session instructions may still name the feature branch, because they are
regenerated on a container reset and predate this decision. **This note is the
newer instruction.** Do not silently fall back to the branch workflow, and do
not take the branch's continued existence as a reason to use it.

**A push to `main` deploys to production.** Vercel builds every push through
the GitHub integration, with no staging gate in between — so the gate is the
one in "Verify by running" below, and it runs _before_ the push, not after.
Typecheck, lint, format, `schedules:check`, the tests and `npm run build` are
seconds each; a production deploy of something that fails one of them is not.

## Two businesses, deliberately separate

The Ledger is a subscription intelligence platform for Georgia commercial
property, business funding and market pricing. DD84 is an automotive tuning
company. They share git ancestry only because of how the repositories were
created, and were separated on purpose.

The branch `claude/consolidate-agent-platform` reverses that separation — it
brings DD84 agent files, 134 `src/` changes and 11 migration changes into this
repository. **It is unmerged and must not be merged without the owner saying so
in as many words.** If you believe consolidation is right, ask; do not infer it
from the branch's existence.

## What this product is not

Not a brokerage, an MLS, a lender, an investment adviser, a legal service or an
appraisal service. It guarantees nothing — not funding, not approval, not
returns, not third-party data accuracy. This is the product's legal position,
not marketing caution.

Never write copy promising funding or approval. Never present a score as advice
or a valuation. **Never invent a statistic, source, testimonial, customer count
or case study** — if a number is needed and you do not have it, leave a marked
placeholder and say so.

## Access control — read this before changing anything

A **rank** answers "how much of a record may this account read": Free 0, Weekly
10, Detailed 20, Premium 30, staff 100. Spaced ten apart so a tier can be
inserted later.

Enforced in **three independent places**, deliberately duplicated:

1. **Row-level security** — 71 policies. Row-level only.
2. **`public.search_opportunities`**, `SECURITY DEFINER` — column-level
   redaction, which RLS cannot express. A Weekly member sees that a Detailed
   record exists without receiving its analysis.
3. **`src/lib/access`** — returns HTTP 402 naming the plan that would unlock it.

Add a field, route or surface and you must consider all three. Adding a column
to an API response without checking the redaction layer is a data leak, not a
styling change. Never move an access decision into the browser.

Two Supabase behaviours that have already caused real vulnerabilities here:

- PostgREST exposes **every** `public` function `authenticated` may execute as
  `POST /rest/v1/rpc/<name>`. A helper function is a public endpoint.
- Supabase grants `EXECUTE` on new functions to `anon`/`authenticated` **by
  name**, so `revoke ... from public` does not remove them. See
  `20260801032955_revoke_privileged_function_grants.sql`.

## Verify by running, not by reading

Every significant defect in this codebase was invisible to review and to `tsc`,
and appeared the first time something actually ran:

- A trigger picked a record field with a SQL `CASE`. PL/pgSQL plans an
  expression as one statement, so a column named on the _untaken_ branch still
  had to resolve. Every insert into `opportunities` would have failed.
- `smoke.sh` reported "nothing sensitive is advertised" against a server that
  was not running — `curl` returned nothing, `grep` found nothing in it.
- A readiness check reported a DNS **timeout** as "SPF record missing".
- `check_rate_limit` declared a PL/pgSQL variable named `window_start`, the
  name of a column on `rate_limit_counters`, so Postgres could not resolve the
  `ON CONFLICT` target and **every call raised 42702**. All thirteen limits in
  `RATE_LIMITS` were inert from the day they were written — login, password
  reset, registration, export, search. Fixed
  `20260925164500_fix_rate_limit_ambiguous_window_start.sql`.
- `/auth/callback` read only `code`. GoTrue signals a refused link with
  `?error=access_denied&error_code=otp_expired`, which arrives _instead_ of a
  code, so it fell into the no-code branch and was discarded. Meanwhile
  `login-form.tsx` read `next` from the query string and never `error`, so the
  `?error=link_expired` the route had been emitting since it was written **had
  never once been displayed to anybody**. Fixed in `857b1ef`.
- That fix then read `searchParams` in a route handler, which **cannot work**:
  GoTrue reports a refused link in the URL **fragment**, and a fragment is
  never transmitted to a server. Observed on the live project the day Site URL
  was corrected:
  `#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`.
  So the server-side check fired for no real case at all. The fragment does
  survive the hop — RFC 7231 §7.1.2 makes a user agent carry it through a 3xx
  whose `Location` has none — so `/login` receives it and
  `noticeForCallbackHash` reads it in the browser, which is the only place it
  exists.

**Run what you build, and prove a guard can fail before trusting it.**

**A route that forwards no reason makes every failure look identical.** The
confirmation-link path is the case. A refused link, a code exchange that could
not complete, and somebody simply opening `/auth/callback` all ended on the
same unexplained sign-in page, so no member could tell which had happened and
neither could we. Two lessons, and the second is the one that bites:

- Emitting a reason is not reporting one. The route emitted
  `?error=link_expired` for months and the page that received it never read the
  parameter. A signal nobody consumes is indistinguishable from no signal, and
  only running the flow shows which you have.
- **Do not render the reason from the query string.** The notice resolves
  through a closed set in `src/lib/auth/callback-notice.ts`, because reflecting
  `?notice=` onto our own sign-in page lets anyone put their words under our
  styling — a phishing message wearing our branding is worse than no message.
  The lookup goes through `hasOwnProperty` so `?notice=constructor` cannot
  render a function body either. Both guards were watched to fail before being
  trusted.

**Name the cause you observed, not the one that is usually true.** A failed
code exchange was reported as an expired link. Expiry is one cause; the
ordinary one is the email being opened in a different browser from the one that
registered, where the PKCE verifier cookie does not exist — the link is fine,
and "request a new one" sends the member round the same loop. This is the third
time this defect has appeared here, after a DNS timeout read as a missing SPF
record and a missing Stripe key read as a bad signature. The pattern is always
the same: one observable, several causes, and the most familiar one written
into the message as though it had been checked.

**A guard that fails open needs a test that watches it refuse.** The rate
limiter is the case that proves it. `checkRateLimit` returns `allowed: true` on
any limiter fault — deliberate, because a database hiccup should not lock every
member out of search — so a total failure and a clean pass produce the same
response, the same status and the same behaviour. The only trace was one
`console.error`, and it went unread for months because nothing had ever
registered. A test asserting that the first call is allowed would have passed
against the broken function for exactly the same reason. So the assertion in
`supabase/verify-rls.sql` drives a key **past** its limit and requires the
refusal; anything less tests the fail-open branch and calls it success.

```bash
npm ci
npm run typecheck && npm run lint && npm run format:check
npm run schedules:check          # deploy cron config must match the job registry
npm test                         # 357 tests
npm run build
npx playwright test --project=desktop-chrome   # 12 skip without a seeded DB — correct
./scripts/verify-schema.sh       # 34 migrations from empty + 17 schema/RLS assertions
npm run preflight                # production readiness; `??` means COULD NOT CHECK
```

## Migrations

34, and five of them were recovered from the production database after being
applied there and never committed (`b811d3a`). Their filenames keep the live
version numbers so the two histories reconcile. Do not renumber them.

A migration in `supabase/migrations` is **not** applied by a deploy. Vercel
builds the application; nothing in that path touches the database. A schema
change reaches production only when somebody applies it, so commit and apply
are two steps and the second is easy to forget — the file being on `main` is
not evidence the live database has it.

`npm run db:seed` fails closed three ways: unset `NEXT_PUBLIC_ENVIRONMENT`,
`=production`, or a non-localhost target without `--remote`. Do not defeat any
of them. Everything it writes is flagged `is_sample`.

## Do not remove the legal banners

Nine of the twelve documents in `src/lib/legal/documents.ts` carry
`requiresReview: true` and render an "awaiting legal review" banner. Removing a
banner does not make a document reviewed — it publishes unreviewed terms under a
real company's name while asserting counsel checked them. The split between the
nine and the three that state our own practice is pinned in
`tests/unit/legal/documents.test.ts`.

## Current state

- Production Supabase project `bbgikfblcahhvrpxiqnd` is **healthy and fully
  migrated**. Verified 2026-09-16 against the live database: all migrations of
  the day applied, reference data present (4 plans, 159 counties, 12 industries), zero
  sample rows, zero tables without RLS, and both August security fixes confirmed
  live — the six service-role-only functions are unreachable by `anon` and
  `authenticated`, and `refresh_opportunity_search_vector` uses PL/pgSQL control
  flow rather than the `CASE` expression. (The Stripe catalogue that check
  described was the DD84 account's; the live one is now the Ledger's own — see
  the Stripe section below.) `20260925164500_fix_rate_limit_ambiguous_window_start.sql`
  has since been applied on top and verified there: the limiter allows two
  calls against a limit of two and refuses the third.
- **`STRIPE_SECRET_KEY` is set** (2026-09-25), verified against `/v1/account`
  before it was stored: `acct_1UIWH6AhiRY2d5kX`, live mode, charges enabled. The
  webhook route now answers `400 Invalid signature` to a bad signature rather
  than `500 Stripe is not configured`, which is the first time that guard has
  actually run — every earlier "Invalid signature" was the missing-key path
  wearing the same status and body.
- What is still **unproven** is a real payment. No card has been through
  Checkout, so the path from a Checkout session to a provisioned subscription
  has never executed end to end. Treat "configured and verified" as exactly
  that, and not as "billing works".
- **The signup flow was run end to end on 2026-10-08** against production, by
  posting to `/api/v1/auth/register` and then reading `confirmation_token`
  straight out of `auth.users` to build the link GoTrue would have emailed. No
  inbox needed. What it established:
  - Registration works. The triggers make the profile and the free-plan
    subscription (rank 0), and `first_name`/`last_name` arrive from metadata.
  - **Confirmation succeeds, and returns `?code=…` in the query string** — not
    a fragment. So the server-side `code` branch in `/auth/callback` is the
    right shape, and the fragment reader covers only the refusal path. Both
    shapes are now observed rather than assumed.
  - **`terms_accepted_at` was never recorded.** The route updated `profiles`
    with the request-scoped client, and with confirmation required `signUp`
    returns no session — so `auth.uid()` is null, `profiles_update_own`
    (`id = auth.uid()`) matched nothing, and the update wrote zero rows with
    nobody reading the error. The form requires accepting the terms, so consent
    was collected and then not stored. **Every account created before this fix
    has `terms_accepted_at` null**, which matters for a product whose legal
    position is the whole of this file. `track('account_created')` in the same
    block worked throughout, because it already used the admin client — which
    is what pinned the diagnosis.
- **The confirmed signup probe was deleted through Authentication → Users on
  2026-10-08**, before any index changes. The dashboard had completed and the
  account was absent at the first follow-up observation, 8.6 seconds after
  clicking Delete (an upper bound, not measured API latency). A subsequent
  production SQL query confirmed zero matching auth users, profiles, and
  subscriptions. The dashboard/admin deletion path therefore completed within
  60 seconds for this account. This does not benchmark a full `prune` batch or
  explain the earlier direct-SQL deletion timeout; its cause remains unknown.
- **The twelve missing indexes on foreign keys referencing `public.profiles`
  were added in `20261008180000_index_profile_deidentification.sql`**, applied
  to production and recorded in `supabase_migrations.schema_migrations` on
  2026-10-08. They cover:
  `attachments.uploaded_by`, `billing_events.user_id`,
  `correction_requests.reviewed_by` and `.submitted_by_user_id`,
  `opportunities.created_by` and `.published_by`,
  `opportunity_score_components.adjusted_by`,
  `opportunity_versions.changed_by`, `reports.approved_by` and `.created_by`,
  `source_checks.checked_by`, `support_tickets.assigned_to`. All nine affected
  tables were empty immediately before application. The indexes support
  finding a deleted profile's references as these tables grow; every
  `on delete set null` relationship is preserved. They are not presented as
  the cause or cure of the earlier timeout. `supabase/verify-rls.sql` now checks
  every profile foreign key for a valid index with the FK columns leading it;
  the check failed on exactly these twelve before the migration and passed
  afterward.
- **Supabase Auth Site URL is correct as of 2026-10-08**, and this was checked
  rather than taken on trust. The probe in `scripts/auth-redirect.ts` now
  completes and names our own host:
  `https://georgiaopportunityledger.com/auth/callback#error=access_denied&error_code=otp_expired&…`.
  It took four rounds to land, and the reason is worth keeping: the change was
  applied to **`eamulcufzjggkmgxkqtd` (`dd84-ai-tuning`)** first, a different
  project in the same picker. Three failed probes in a row, each with a healthy
  control, were all reporting the Ledger's project accurately.

  A real signup has since confirmed successfully through this path — see the
  end-to-end run recorded above.

- **Supabase Auth pointed at localhost until 2026-10-08.** The first
  confirmation email proved it: `email_confirmed_at` was set, but
  `GET /auth/callback` never appeared in the Vercel logs and the browser landed
  on an unreachable page.
  The application asks for the right destination —
  `register/route.ts` sets `emailRedirectTo` to `${siteUrl}/auth/callback`, and
  the route exists — but Supabase only honours `redirect_to` when it matches
  the **Redirect URLs** allow-list, and otherwise falls back to **Site URL**.
  Fix both under Authentication → URL Configuration; there is no MCP tool for
  auth settings, the sandbox proxy refuses `api.supabase.com`, and no access
  token is in the environment, so it is a Dashboard change. Confirming an
  address still works, so an account created before the fix can simply sign in
  at `/login`.
  `npm run preflight` now decides this rather than trusting it — see
  `scripts/auth-redirect.ts`. The setting is invisible to every client, so the
  check asks GoTrue to verify a deliberately invalid token with our callback as
  `redirect_to` and reads the `Location` header **without following it**: the
  token is refused either way, and the host it names is the setting. A host that
  is not ours is a `fail`, not an `unknown`. Run it from somewhere that can
  reach the Supabase host — from this sandbox the proxy answers 403 first and
  the row is correctly `unknown`, which is why the row never names who replied.

  **That check measures the Site URL, not the allow-list**, though it first
  claimed otherwise. Running the probe twice against the live project — once
  with the allow-listed callback, once with `https://example.com/not-allow-
listed` — gave identical answers, and neither host was the destination while
  both were independently reachable from the same client. On a **refused** token
  GoTrue never consults `redirect_to`. So a project with the right Site URL and
  an empty allow-list passes the check and still drops members on the site root
  with no session. Set both, and treat a pass as "Site URL is ours", not
  "confirmation works" — only a real signup proves the chain.

- **The account has three Supabase projects, two of them active**:
  `bbgikfblcahhvrpxiqnd` (the Ledger), `eamulcufzjggkmgxkqtd` (`dd84-ai-tuning`,
  created 2026-09-24, the other business) and the inactive `gol-staging`. The
  Dashboard project picker shows all three, so check the ref in the URL before
  changing an auth setting. **This is not hypothetical: the URL Configuration
  change intended for the Ledger was applied here first**, which is what three
  consecutive failed probes were correctly reporting.

  `dd84-ai-tuning` was probed read-only on 2026-09-29 and its **Site URL** was
  the untouched `localhost` default. That is all the probe can see, and the
  earlier claim here that "nothing of the Ledger's has leaked into it" went
  further than the evidence: the probe cannot read the **Redirect URLs**
  allow-list, so a Ledger callback allow-listed on the tuning company's project
  would be invisible to it. Check that list by hand and remove anything of
  ours; nothing of ours belongs there.

- An earlier note here said this project "came back empty" after a September
  pause and restore. That was wrong. The check ran about two minutes after the
  restore was initiated: Postgres answered, the data had not finished restoring,
  and an in-progress restore was read as data loss. Nothing was ever lost. Wait
  for a restore to complete before concluding anything from an empty schema.
- `gol-staging` (`bahdfxljazvegvgccvxy`) exists and is inactive.

## The live site and its domain

Production is **`https://georgiaopportunityledger.com`**, registered through
Vercel on 2026-09-22 (expires 2027-09-22, auto-renew on). Vercel is both
registrar and DNS host — `serviceType: zeit.world`, nameservers
`ns1`/`ns2.vercel-dns.com` — so there is no third-party control panel in the
path. `georgia-opportunity-ledger.vercel.app` remains attached and serving.

`gaopportunityledger.com` is a different domain and **is not ours to route**.
It is attached to the project, but its nameservers are authoritative at
`globaldomaingroup.com`, a registrar nobody here has a login for. It returns
404 and always will until that changes. Leave it attached; it costs nothing.

**`verified: true` on a Vercel domain does not mean the domain serves the
site.** It means ownership was proven. `gaopportunityledger.com` has reported
`verified: true` throughout while returning 404. Cutting over on that flag once
pointed the scheduler at a dead host and stopped every job for about three
minutes. Before moving anything, fetch the domain and require a **200**.

The sandbox proxy refuses `CONNECT` to these hosts, so `curl` from here proves
nothing — the same shape as the `smoke.sh` bug. Check from outside instead:

```sql
select net.http_get('https://georgiaopportunityledger.com/');   -- returns an id
select id, status_code, error_msg from net._http_response where id = <id>;
```

A fresh domain answers `SSL connect error` for the first minute or so while the
certificate is issued. That is not a failure; re-check rather than concluding.

To prove the scheduler can authenticate against a host **without running a
job**: POST to `/api/v1/jobs/<nonexistent>` with the real `ledger_cron_secret`.
The route checks the secret before it looks the job up, so a valid secret gives
404 with the job registry and a wrong one gives 401. Run both — a guard nobody
has watched refuse is not a guard.

A domain cutover is **four** changes that move together, none of which is
sufficient alone:

1. `NEXT_PUBLIC_SITE_URL` in Vercel — inlined at build time, so it does nothing
   until a **redeploy**. Until then `robots.txt` and `sitemap.xml` keep naming
   the old host as canonical, which is the whole reason this matters.
2. The `ledger_site_url` Vault secret — this is what `pg_cron` dispatches to.
   Getting this wrong is what breaks the scheduler.
3. The Stripe webhook endpoint URL — now `we_1UIXEvAhiRY2d5kX1wB1MwCN` on the
   Ledger's own account. Changing an endpoint's URL does **not** change its
   signing secret, so a domain move leaves `STRIPE_WEBHOOK_SECRET` alone.
   Replacing the endpoint, as the account migration did, does not.
4. `EMAIL_FROM` / `EMAIL_REPLY_TO`. These pointed at `gaopportunityledger.com`,
   where SPF and DKIM can never be published because we do not hold its DNS.
   Mail from that address could not have been delivered. Latent only because
   `EMAIL_PROVIDER=console` sends nothing.

## Stripe — the Ledger bills through its own account

**`acct_1UIWH6AhiRY2d5kX` — "georgia-opportunity-ledger"** is the live account
as of 2026-09-22. Activated: `charges_enabled`, `details_submitted` and
`payouts_enabled` all true, nothing `currently_due`. It holds the four products
and six prices, all carrying `txcd_10701400`, and the webhook endpoint
`we_1UIXEvAhiRY2d5kX1wB1MwCN` with eight events. `subscription_plans` points at
its ids, verified against the live catalogue rather than merely populated:
weekly $15/$150, detailed $39/$390, premium $99/$990, free no price at all,
lookup keys `gol_<code>_<monthly|annual>`.

**Three accounts are named "Down Dirty 84 llc"** —
`acct_1QBl8ZINLKqe1c6g`, `acct_1SGHSjL9R5PTdFyY` and `acct_1U9UzJA7O7B8jKDv`.
The name does not identify one; always select by id. The Ledger's history is in
`acct_1QBl8ZINLKqe1c6g` alone: it holds the four abandoned
`georgia_opportunity_ledger` products beside DD84's own, and held the old
webhook endpoint. The other two have no webhook endpoints at all.

That endpoint, `we_1UIRt3INLKqe1c6gKR3e3bab`, is **disabled** as of 2026-09-22
and its description records why. It pointed at
`georgiaopportunityledger.com/api/v1/webhooks/stripe`, which now belongs to the
Ledger's own account.

Two things this note previously asserted without checking, both wrong:

- That the endpoint was producing "a stream of 400s and eventually a Stripe
  warning". The runtime logs showed it delivering **nothing**. That was
  reasoning about what a misdirected endpoint _would_ do, written as though
  observed.
- That connecting the Ledger's account **replaced** DD84 in the Stripe
  connector, so only one was reachable at a time. All four are connected
  simultaneously. Whatever made DD84 disappear earlier, it was not a
  one-at-a-time limit, and no dashboard round trip was needed to disable the
  endpoint — the API did it.

Either way a wrong-account event could not have been mis-processed:
`STRIPE_WEBHOOK_SECRET` holds the Ledger account's secret, so verification
fails closed.

Billing through DD84 would have made the tuning company merchant of record on
every subscription — its name on the customer's statement, its revenue, its
1099-K. That is why this moved, and why the two accounts stay apart.

Moving it did not make the Ledger merchant of record either. **Managed Payments
is enabled on this account, so Stripe is** — it collects from the customer and
pays us out, and it owns the tax, fraud and dispute obligations that go with
that. What changed is whose business the subscription belongs to, which is the
part that mattered. See "Stripe Tax and Smart Retries" below.

`subscription_plans.free.stripe_product_id` used to be `prod_V9odG9TGmnpjcB`, a
product existing in neither account. Harmless, since the free plan has no price
and never reaches Checkout, but the same class of error as the wrong-account
price ids. It now points at `prod_VJ9Tb0VMNhpwP6`.

`stripe-setup.ts` now refuses to run when the key's mode and
`NEXT_PUBLIC_ENVIRONMENT` disagree, and prints the resolved Stripe account id
and target database host before writing. A `sk_test_` key against the
production database would otherwise write test price ids onto the live plans —
failing at the till rather than at deploy time. The guard lives in
`scripts/stripe-mode.ts` so it can be tested without executing the script, and
`tests/unit/scripts/stripe-mode.test.ts` watches it refuse in every direction.

**A verification probe against this account belongs in a sandbox.** Creating
live Checkout Sessions to confirm the six prices resolved left six payable
`cs_live_` URLs sitting open for their full 24-hour life, each carrying
`client_reference_id: "probe-checkout-flow"` — a user id matching no account.
Paying one would have taken real money and provisioned nothing: the webhook
fires, `onCheckoutCompleted` looks the user up, finds no profile. The owner
nearly paid one, having reasonably assumed a Stripe page reached mid-test was
the one the site had just created.

A sandbox proves a price id resolves exactly as well. If a live probe is
genuinely unavoidable, expire the session in the same breath that creates it —
and note that this connector exposes create, retrieve and list for Checkout
Sessions but **not expire**, so "I will clean it up after" is a promise the
tooling may not let you keep. The six had to be expired by hand in the
Dashboard.

## Webhooks: recorded is not processed

`billing_events.stripe_event_id` is unique, and the insert is the idempotency
lock. The row is written **before** the event is handled, so a conflict means
the event was _recorded_ before — not that it was _handled_. Conflating those
two silently discarded events: a handler that threw left `processed = false`
and answered 500, Stripe retried, the retry hit the conflict and was
acknowledged as a duplicate, and the one mechanism meant to recover the event
was the one throwing it away. Nothing swept it up either — `sync-subscriptions`
counts unprocessed rows for a dashboard number and does not reprocess them.

So a conflict is a duplicate to acknowledge **only when `processed` is true**.
Otherwise the delivery reprocesses, carrying `attempt_count` forward so an
event failing for the fifth time does not read as a first attempt.

`sync-subscriptions` reconciles the **plan** as well as the status. It did not,
which left the one field deciding what a member may read outside the safety
net: an upgrade or downgrade whose webhook failed kept its old `plan_id`, and
therefore its old access rank, permanently — status recovered on the next run,
entitlement never did. An unrecognised price leaves the plan alone rather than
falling back to free; a catalogue mismatch must not revoke paid access.

The price → plan lookup is shared by both in `src/lib/billing/plans.ts`, so the
webhook and the job cannot disagree about what a price means.

**Finishing a Checkout session is not paying for it.** A delayed payment method
— ACH debit, bank transfer, some wallets — completes the session with
`payment_status: 'unpaid'` and settles, or fails, days later. So
`onCheckoutCompleted` records the customer id and then stops when the session
is unpaid; `checkout.session.async_payment_succeeded` re-enters the same
handler once the money is there. Nothing on this account uses such a method
today, which is exactly the point: enabling one is a Dashboard toggle that
touches no code, and without the guard the symptom would be free paid access
rather than an error.

Eight events are subscribed, and the code and the endpoint must be changed
together — a handler for an event the endpoint does not send is dead code, and
Stripe sending one nothing handles is a silent gap:

```
checkout.session.completed                 customer.subscription.created
checkout.session.async_payment_succeeded   customer.subscription.updated
checkout.session.async_payment_failed      customer.subscription.deleted
invoice.payment_succeeded                  invoice.payment_failed
```

`invoice.payment_succeeded` fires on every renewal, not only on recovery, so it
notifies the member only when the stored status was `past_due` or `unpaid` —
otherwise it would send a "your payment worked" message twelve times a year. It
reconciles by re-reading the subscription from Stripe rather than setting the
status itself, keeping one writer for that field.

## A missing key is not a bad signature

`stripe()` builds its client from `serverEnv().stripeSecretKey`, which throws
when the variable is unset — and the webhook route calls
`stripe().webhooks.constructEvent(...)`. So while `STRIPE_SECRET_KEY` is
missing, **the webhook cannot verify anything at all**: the failure happens
before verification is attempted. It is not only checkout that stops.

Both that call and `env.stripeWebhookSecret` used to throw inside the
verification `try`, so the log said "signature verification failed" and the
response said `Invalid signature` — a configuration fault dressed as a caller
error, and the reason this went unnoticed in production while every delivery
was rejected. Reading configuration now happens in its own block, and returns
`Stripe is not configured.`

The status mattered more than the message. **Stripe treats 4xx as permanent and
does not retry**, so every event that arrived while the key was missing was
discarded rather than deferred. It is a 500 now, which Stripe retries, so the
backlog lands once the variable is set.

The general lesson is the one already in "Verify by running": a 400 observed
from outside proved nothing here, because two unrelated faults produced the
same status and the same body. Check the runtime log for the reason, not the
status code for the shape.

## Stripe Tax and Smart Retries

**Tax category is set per product, not per account.** The four Ledger products
carry `txcd_10701400`, "Website Information Services - Business Use": an online
service furnishing information, including search and data comparison, reached
through a SaaS program. Business use because subscribers are businesses, and
that split only affects US sales, which is all of ours. `stripe-setup.ts` holds
the constant, sets it on create, and corrects it on reuse — a product is
mutable and its tax code decides what is charged, so "already exists" must not
mean "left as whatever it was".

It is deliberately not left to the account default. That default is
`txcd_10000000`, whose own description says to prefer something more specific
for US sales, and on a shared account the default belongs to whichever business
set it. Two neighbours were rejected: `txcd_10701410` (information delivered
electronically _without_ a SaaS program) and `txcd_10503005` (articles and
newsletters by subscription — a publication, not a searchable database).

The code must stay on Stripe's **Managed Payments eligible list** — see below.
`txcd_10701400` was added to it on 2025-08-22 and is eligible; the neighbours
rejected above are not all on that list. Changing this constant to something
ineligible breaks tax calculation at the till rather than at deploy time.

**Managed Payments is enabled, so Stripe is the merchant of record.** Every
Checkout Session on `acct_1UIWH6AhiRY2d5kX` comes back with
`managed_payments: {enabled: true}`, `automatic_tax` enabled and
`liability.type: stripe`. The app sets none of that; it is account
configuration, and it required accepting a separate Terms of Service. Confirmed
deliberate by the owner 2026-09-25.

What it means, from Stripe's own documentation rather than inference: Stripe
calculates, collects, files and remits indirect tax in 80+ countries; handles
fraud, disputes and transaction-level customer support; emails receipts,
invoices and some subscription notices to customers directly; and turns on Link
and Adaptive Pricing, so customers may be quoted in their local currency.

So **do not reason about tax from this account's own tax settings.** They read
`status: pending` with `head_office` missing and no registrations, which under
any other arrangement would mean "nothing is calculated". Under Managed
Payments, Stripe's registrations apply instead. For countries Managed Payments
does not cover, the liability is still ours and Stripe Tax can calculate it at
no extra charge.

An earlier version of this section described tax settings, registrations and
threshold monitoring as though they were the Ledger's. **They were read from
`acct_1QBl8ZINLKqe1c6g`, the DD84 account, and generalised without checking
this one.** Leave DD84's account-wide settings alone regardless — its head
office is `419 Thomas Road, Hull, GA` and its default tax code covers stickers
and tuning work, so editing either to suit the Ledger is exactly the
cross-contamination the separation exists to prevent.

`payment_method_types` on a live session is `["card", "cashapp"]`. Nothing in
the code requests Cash App Pay; Managed Payments brings its own payment-method
set. This is the case the unpaid-session guard was written for, arriving
without a deploy.

**Smart Retries has no API.** Every Stripe doc routes to the Dashboard:
Billing → Revenue recovery → Retries. It cannot be scripted, so it is not in
this repository and will not appear in any diff — which is exactly why it is
written down here. Stripe's recommended policy is 8 attempts over 2 weeks.
Enable the failed-payment emails alongside it under Settings → Billing →
Subscriptions and emails; they are complementary, not redundant. Smart Retries
recovers silently, while `invoice.payment_failed` gates access and tells the
member.

**Managed Payments does not supersede Smart Retries**, though it was asserted
here that it did. Retries are Billing-level dunning against a subscription's
invoices, and nothing in Stripe's documentation says Managed Payments takes
them over; what it takes over is tax, fraud, disputes and transaction support.
Still to be enabled on `acct_1UIWH6AhiRY2d5kX`. The one genuine overlap is
email: Managed Payments already writes to customers directly, so check what a
member actually receives before adding the Dashboard failed-payment email on
top of it.

`PAST_DUE_GRACE_DAYS` is 3 and the retry window is a fortnight, so a member can
lose access while Stripe is still retrying. That is deliberate — three days is
how long paid access survives a failed charge — but the two numbers are related
and changing the retry window without revisiting the grace period will surprise
somebody.

## Deploying on Vercel — two hobby-plan limits bite

The team is on the **hobby** plan, and the committed configuration does not fit
it:

- **Cron cadence.** Hobby enforces a once-per-day minimum, and an expression
  that fires more often fails at deploy time. Six of the fourteen schedules in
  `vercel.json` fire more often than daily.
- **Function duration.** Hobby caps functions at 60 seconds.
  `/api/v1/jobs/[job]` declares `maxDuration = 300`. Pro allows far more.

So one of these has to be true before a Vercel deploy succeeds: the team is on
Pro, or the crons are driven externally (an external caller hitting
`/api/v1/jobs/{job}` with the `CRON_SECRET` bearer token, as already described
for Netlify in `docs/RUNBOOK.md`) and the long jobs fit inside 60 seconds.

Linking the repository also requires the Vercel GitHub App to be installed on
it — https://github.com/apps/vercel.

## Remaining launch blockers — none of them code

Legal review of the nine documents, a card through each tier, point-in-time
recovery, a human accessibility audit, and a scanner endpoint for
`FILE_SCANNER_URL`.
