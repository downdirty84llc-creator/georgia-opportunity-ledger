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
   account; everything on our side is ready for it.
2. **Legal review of all twelve documents.** A hard launch blocker. Each renders
   an "awaiting legal review" banner until cleared.
3. **Virus scanning on uploads.** Spec 20 says "where supported". The
   `attachments.scan_status` column exists and defaults to `pending`; no scanner
   is wired to it.
4. **High-fidelity design and brand sign-off** (milestone 1).
5. **Public landing pages are server-rendered per request, not cached.** The
   marketing layout renders a session-aware header, which makes the whole route
   dynamic. Spec 23 asks for these to be cached. Fixing it properly means moving
   the auth-dependent part of the header to a client component or adopting
   partial prerendering — worth doing before launch, and deliberately not
   bodged in the meantime.
6. **Super-administrator MFA reset.** A staff member who loses their
   authenticator currently needs intervention through Supabase directly; the
   in-product reset described on `/admin/security` is not built.
