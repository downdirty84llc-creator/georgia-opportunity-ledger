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

**Run what you build, and prove a guard can fail before trusting it.**

```bash
npm ci
npm run typecheck && npm run lint && npm run format:check
npm run schedules:check          # deploy cron config must match the job registry
npm test                         # 267 tests
npm run build
npx playwright test --project=desktop-chrome   # 12 skip without a seeded DB — correct
./scripts/verify-schema.sh       # 31 migrations from empty + 15 RLS assertions
npm run preflight                # production readiness; `??` means COULD NOT CHECK
```

## Migrations

31, and five of them were recovered from the production database after being
applied there and never committed (`b811d3a`). Their filenames keep the live
version numbers so the two histories reconcile. Do not renumber them.

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
  migrated**. Verified 2026-09-16 against the live database: all 31 migrations
  applied, reference data present (4 plans, 159 counties, 12 industries), zero
  sample rows, zero tables without RLS, and both August security fixes confirmed
  live — the six service-role-only functions are unreachable by `anon` and
  `authenticated`, and `refresh_opportunity_search_vector` uses PL/pgSQL control
  flow rather than the `CASE` expression. Stripe's live catalogue is complete:
  four products, monthly and annual price ids on all three paid tiers.
- `opportunities` and `profiles` are both 0. No application has ever talked to
  this database.
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
3. The Stripe webhook endpoint URL — `we_1UIRt3INLKqe1c6gKR3e3bab`. Changing
   the URL does **not** change the signing secret, so `STRIPE_WEBHOOK_SECRET`
   stays as it is.
4. `EMAIL_FROM` / `EMAIL_REPLY_TO`. These pointed at `gaopportunityledger.com`,
   where SPF and DKIM can never be published because we do not hold its DNS.
   Mail from that address could not have been delivered. Latent only because
   `EMAIL_PROVIDER=console` sends nothing.

## Stripe — two accounts, and the Ledger is moving to its own

There are two, and the difference is the separation rule applied to money:

- **`acct_1QBl8ZINLKqe1c6g` — "Down Dirty 84 llc".** Holds the live catalogue
  the plan rows currently point at, the live webhook
  `we_1UIRt3INLKqe1c6gKR3e3bab`, and DD84's own tuning and sticker products
  side by side with the four `georgia_opportunity_ledger` ones. Billing the
  Ledger here makes the tuning company merchant of record on every
  subscription — its name on the customer's statement, its revenue, its 1099-K.
- **`acct_1UIWH6AhiRY2d5kX` — "georgia-opportunity-ledger".** The account the
  Ledger is moving to, decided by the owner 2026-09-22. Empty catalogue, and
  **`charges_enabled: false`** — it cannot take a payment until activated.

The move is `npm run stripe:setup` with that account's **live** key. The script
already does the whole job: it creates the four products and six prices and
writes the ids onto `subscription_plans`, matching products on
`metadata.plan_code` and prices on lookup key, so it is safe to re-run. What it
does **not** do is the webhook — create a new endpoint on the new account for
`/api/v1/webhooks/stripe` and put its signing secret in `STRIPE_WEBHOOK_SECRET`.

The catalogue to reproduce, for checking the result: weekly $15/$150, detailed
$39/$390, premium $99/$990, free has no price at all. Lookup keys are
`gol_<code>_<monthly|annual>`.

While confirming this, `subscription_plans.free.stripe_product_id` was found to
be `prod_V9odG9TGmnpjcB`, a product that **does not exist** in either account.
Harmless — the free plan has no prices and never reaches Checkout — but it is
the same class of error as the wrong-account price ids, and `stripe:setup`
overwrites it.

`stripe-setup.ts` now refuses to run when the key's mode and
`NEXT_PUBLIC_ENVIRONMENT` disagree, and prints the resolved Stripe account id
and target database host before writing. A `sk_test_` key against the
production database would otherwise write test price ids onto the live plans —
failing at the till rather than at deploy time. The guard lives in
`scripts/stripe-mode.ts` so it can be tested without executing the script, and
`tests/unit/scripts/stripe-mode.test.ts` watches it refuse in every direction.

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
