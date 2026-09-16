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
npm test                         # 240 tests
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

- Production Supabase project `bbgikfblcahhvrpxiqnd` came back **empty** after a
  pause and restore in September. The schema is fully reproducible from the 31
  migrations plus `supabase/seed.sql`; whether to restore a dashboard backup or
  re-push is an open owner decision.
- `gol-staging` (`bahdfxljazvegvgccvxy`) exists and is inactive.
- Remaining launch blockers are not code: legal review, a card through each
  tier, point-in-time recovery, a human accessibility audit, a scanner endpoint.
