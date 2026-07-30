# Milestone status

Against the ten milestones in specification section 28. This is an honest
accounting: "Done" means implemented and typechecked, with unit tests where the
logic is testable without a database. Nothing here has been run against a live
Supabase instance or live Stripe account.

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
migrations, email/password and magic-link authentication, Google sign-in wired
in Supabase config, profiles created by database trigger, the full role system,
public pages, and all twelve legal documents behind `/legal/[slug]`.

## Milestone 3 — Billing and access

**Done in code; needs a Stripe account to verify.** Checkout, customer portal,
plan change with upgrade/downgrade proration policy, cancellation at period end,
and an idempotent webhook handler. Access-rank enforcement is implemented in all
three layers described in `ARCHITECTURE.md`.

Outstanding: create the products and prices in Stripe, populate
`stripe_monthly_price_id` / `stripe_annual_price_id` on `subscription_plans`,
and run the tier-by-tier test-payment matrix the acceptance criterion requires.

## Milestone 4 — Opportunity database

**Done.** Opportunity schema with property and funding detail tables, source
management with the terms-review constraint, full-text search, the filter and
sort surface from spec 11, cursor pagination, opportunity cards, and tier-aware
detail pages.

## Milestone 5 — Administrative workflow

**Mostly done.** Draft workflow, review queue with approve/publish actions,
transition validation with role checks, scoring with mandatory adjustment
reasons, version history on material change, and audit logging on every action
spec 7.15 lists.

Outstanding: the seven-step opportunity editor form (spec 15.2). The API
supports every field; the guided form is not built, so a non-technical
administrator currently cannot create a record end to end without help. This is
the largest remaining gap for the "without developer assistance" acceptance
criterion.

## Milestone 6 — Member features

**Done.** Dashboard with personalised recommendations and metrics, saved
opportunities with status and notes, deadline calendar with per-record `.ics`
export, preferences surface, and locked-content states that name the exact
feature withheld and the plan that unlocks it.

## Milestone 7 — Reports and email

**Done.** Report schema with per-section access ranks, publish and schedule
endpoints, dependency-free PDF generation, the weekly distribution job with
per-member personalisation, and all five transactional templates in HTML and
plain text with unsubscribe and preference links.

Outstanding: the drag-and-drop report builder (spec 15.4).

## Milestone 8 — Premium features

**Done.** Saved searches with immediate alert matching, the alert pipeline with
content-addressed suppression, CSV export with formula-injection defence and
async handling above 500 rows, alert preferences, and premium-briefing access
gating.

## Milestone 9 — Analytics and optimisation

**Mostly done.** First-party analytics events with property scrubbing, admin
dashboard with subscriber counts, MRR, failed payments, editorial backlog and
job-run observability.

Outstanding: Sentry and PostHog are configured by environment variable but not
wired up; content-level analytics (per-record view counts) are captured as
events but not aggregated into a report.

## Milestone 10 — Launch

**Not started** — correctly, since it depends on the outstanding items above.
See `RUNBOOK.md` for the checklist.

---

## Summary of what is not built

1. The seven-step opportunity editor form (spec 15.2).
2. The drag-and-drop report builder (spec 15.4).
3. Stripe products, prices and the test-payment matrix.
4. Sentry and PostHog wiring.
5. Legal review of all twelve documents — a hard launch blocker.
6. Administrator multi-factor enrolment enforcement (Supabase MFA is available;
   the enrolment gate is not implemented).
7. Virus scanning on uploads (spec 20 says "where supported"; the
   `attachments.scan_status` column exists and defaults to `pending`).
