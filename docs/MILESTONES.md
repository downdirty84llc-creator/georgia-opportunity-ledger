# Milestone status

Against the ten milestones in specification section 28. This is an honest
accounting: "Done" means implemented, typechecked and linted, with unit tests
where the logic is testable without a database. Nothing here has been run
against a live Supabase instance or live Stripe account.

---

## Milestone 1 — Discovery and design system

**Partial.** A working design system exists (`tailwind.config.ts`,
`src/app/globals.css`, `src/components/ui/primitives.tsx`) with a defined
palette, type scale, and accessible primitives: focus-visible rings, meters with
`role="meter"` and text labels, badges that never carry status by colour alone,
reduced-motion support.

Not delivered: high-fidelity comparative design work, a confirmed brand
direction, or owner sign-off. That is a design engagement, not a code artefact.

## Milestone 2 — Foundation

**Done.** Repository, environment separation, complete schema across 21
migrations, email/password and magic-link authentication, password reset (both
halves of the flow on one page), Google sign-in wired in Supabase config,
profiles created by database trigger, the full role system, public pages, and
all twelve legal documents behind `/legal/[slug]`.

## Milestone 3 — Billing and access

**Done in code; needs a Stripe account to verify.** Checkout, customer portal,
plan change with upgrade/downgrade proration policy, cancellation at period end
with a confirmation that states what the member keeps, and an idempotent webhook
handler. A full billing page shows plan, status, renewal, interval and amount.
Access-rank enforcement is implemented in all three layers described in
`ARCHITECTURE.md`.

Outstanding: create the products and prices in Stripe, populate
`stripe_monthly_price_id` / `stripe_annual_price_id` on `subscription_plans`,
and run the tier-by-tier test-payment matrix the acceptance criterion requires.

## Milestone 4 — Opportunity database

**Done.** Opportunity schema with property and funding detail tables, source
management with the terms-review constraint, full-text search, the filter and
sort surface from spec 11, cursor pagination, opportunity cards, and tier-aware
detail pages.

## Milestone 5 — Administrative workflow

**Done.** Draft workflow, review queue with approve/publish actions, transition
validation with role checks, version history on material change, audit logging
on every action spec 7.15 lists, and the seven-step opportunity editor
(spec 15.2) with autosave, local draft recovery, live scoring, a per-tier
preview and a publish gate that names the missing fields and links to the step
each one lives on.

Acceptance met: an administrator can now take a record from creation through
review to publication without developer assistance.

## Milestone 6 — Member features

**Done.** Dashboard with personalised recommendations and metrics, saved
opportunities with status and notes, deadline calendar with per-record `.ics`
export, a full preferences surface (counties, industries, property and funding
types, capital range, minimum score, time zone), and locked-content states that
name the exact feature withheld and the plan that unlocks it.

## Milestone 7 — Reports and email

**Done.** Report schema with per-section access ranks, the report builder
(spec 15.4) with record search, keyboard-accessible ordering, per-entry
commentary, per-entry and per-section tier gating, a live access preview and
schedule/PDF/distribution settings. Dependency-free PDF generation, the weekly
distribution job with per-member personalisation, and all five transactional
templates in HTML and plain text.

Email additionally supports RFC 8058 one-click unsubscribe: signed tokens,
`List-Unsubscribe` headers, an endpoint that works without a login, and a
granular per-alert-type preference page.

## Milestone 8 — Premium features

**Done.** Saved searches with immediate alert matching, the alert pipeline with
content-addressed suppression, CSV export with formula-injection defence and
async handling above 500 rows, alert preferences, and premium-briefing access
gating.

## Milestone 9 — Analytics and optimisation

**Done.** First-party analytics events with property scrubbing, forwarded to
PostHog server-side from the same scrubbed payload. Error reporting to Sentry
from the API error handler and the job runner. Admin dashboard with subscriber
counts, MRR, failed payments, editorial backlog and job-run observability.

Both integrations are implemented without their vendor SDKs — see
`ARCHITECTURE.md` §12 for why, and what that costs.

## Milestone 10 — Launch

**Not started** — correctly, since it depends on the outstanding items below.
See `RUNBOOK.md` for the checklist.

---

## What is still not built

1. **Stripe products, prices and the test-payment matrix.** Needs a Stripe
   account; everything on our side is ready for it. The checkout endpoint
   returns a clear conflict rather than failing inside Stripe when a price id
   is missing, so this is safe to verify by trying it.
2. **Legal review of all twelve documents.** A hard launch blocker. Each renders
   an "awaiting legal review" banner until cleared.
3. **A virus scanner to point the pipeline at.** The pipeline itself is built
   (see below); production still needs a ClamAV endpoint in `FILE_SCANNER_URL`.
   Until one exists, files store as `skipped` and a warning is logged in
   production. That is a deployment task, not a code task.
4. **High-fidelity design and brand sign-off** (milestone 1). A design
   engagement, not a code artefact.
5. **`/pricing` and `/support` remain server-rendered per request.** Both
   genuinely personalise — pricing marks the plan you are on, support knows
   whether you are signed in — so this is a deliberate exception rather than
   the gap the previous entry described. `/georgia/[county]` is cached on
   demand rather than prerendered, because prerendering 159 counties would put
   the database on the build's critical path for pages that change weekly.

## Closed since the last revision

**Public landing pages are cached (spec 23).** The marketing layout rendered a
session-aware header, and reading the session means reading cookies, which made
every page beneath it dynamic. The header now renders a static shell and
resolves the session in the browser; the member and admin shells, dynamic
anyway, still render theirs on the server from an already-resolved session. The
home page, all four category pages, insights, the sample report and every legal
document are now prerendered with their declared `revalidate` windows.

The same pass hardened the failure mode that made this worth doing carefully:
`src/lib/public-data.ts` now fails a production or staging build outright when
it cannot read, rather than baking an empty page and serving it for the whole
revalidate window.

**Virus scanning on uploads (spec 20).** `attachments.scan_status` existed but
nothing set it and nothing read it — and there was no upload path at all. Now
there is: an editorial-only multipart endpoint, magic-byte checking against the
declared type, a scanner behind a provider interface, storage-then-scan
ordering so a killed process leaves a hidden file rather than an exposed one, a
read policy that withholds anything not `clean` or `skipped`, quarantine and
deletion on a hit, and a `scan-attachments` job that retries what did not
resolve. See `ARCHITECTURE.md` §16.

**Super-administrator two-factor reset.** Recovery for a lost authenticator was
a Supabase dashboard login — outside the product, unaudited, and available to
whoever held infrastructure credentials rather than to the role the
specification assigns it to. `/admin/staff` now shows every staff account's
enrolment state and lets a super administrator clear one, with a mandatory
reason on the audit row and a hard block on resetting your own.
