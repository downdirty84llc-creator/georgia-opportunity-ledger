# DD84 task register

The live register of operational work, in the task standard of
`docs/DD84-OPERATIONS-AGENT.md` §4. This file is controlling. A task that exists
only in a chat transcript does not exist.

- **Seeded** 2026-08-06 from repository evidence — `git log`, `docs/MILESTONES.md`,
  `docs/RUNBOOK.md`, `CLAUDE.md` — plus the statuses the owner stated for T-06,
  T-12, T-18, T-19, T-20 and packets A-05 to A-07.
- Fields that could not be sourced from an artifact read **`not recorded`**
  rather than a plausible guess. Filling one in is a task of its own.
- **Due dates on tasks that are not yet approved are Torque's proposal, not an
  owner commitment.** They become commitments when the covering packet is
  approved.
- Statuses and their meanings are in `README.md`. **Done requires evidence in
  `OPERATING-LOG.md`.** Without it the status is In Verification.

Workstreams in use: `ledger` (Georgia Opportunity Ledger software), `ops`
(operating system for the agent itself), `finance`, `compliance`, `design`.
Customer, service, marketing, procurement and real-estate workstreams have no
open tasks yet — no intake routine has run against a live connector.

---

## Summary

| ID   | Title                                                               | Workstream | Priority | Status              | Owner | Approval         | Due          |
| ---- | ------------------------------------------------------------------- | ---------- | -------- | ------------------- | ----- | ---------------- | ------------ |
| T-01 | Transcribe the DD84 operations specification into the repository    | ops        | High     | Done                | Agent | A-01             | 2026-07-31   |
| T-02 | Author CLAUDE.md as the repository orientation guide                | ops        | High     | Done                | Agent | A-01             | 2026-07-31   |
| T-03 | Define the Torque agent as a reusable subagent                      | ops        | High     | Done                | Agent | A-01             | 2026-07-31   |
| T-04 | Correct documentation that had drifted away from the code           | ledger     | Normal   | Done                | Agent | A-02             | 2026-07-31   |
| T-05 | Record the true legal-review flags on the ten legal documents       | compliance | High     | Done                | Agent | A-02             | 2026-07-31   |
| T-06 | Exclude demo accounts from subscriber, revenue and analytics counts | finance    | High     | **In Verification** | Agent | A-03             | 2026-08-08   |
| T-07 | Count annual subscribers at a twelfth of the annual price           | finance    | High     | Done                | Agent | A-04             | 2026-07-31   |
| T-08 | Remove the phantom integration-test glob from the Vitest config     | ledger     | Normal   | Done                | Agent | S-01             | 2026-08-02   |
| T-09 | Close the PostgREST filter injection in the opportunity fallback    | ledger     | High     | Done                | Agent | S-01             | 2026-08-02   |
| T-10 | Correct the test counts and integration-suite claim in CLAUDE.md    | ops        | Normal   | Done                | Agent | S-01             | 2026-08-05   |
| T-11 | Create Stripe products and prices and run the test-payment matrix   | finance    | Critical | Awaiting Approval   | Owner | **A-05 pending** | 2026-08-20   |
| T-12 | Record the sample-data exclusion rule in CLAUDE.md                  | ops        | Normal   | Done                | Agent | A-03             | 2026-07-31   |
| T-13 | Commission legal review of the ten legal and policy documents       | compliance | Critical | Awaiting Approval   | Owner | **A-06 pending** | 2026-08-27   |
| T-14 | Wire virus scanning to `attachments.scan_status`                    | ledger     | High     | Awaiting Approval   | Owner | **A-07 pending** | 2026-09-03   |
| T-15 | Make the public landing pages cacheable again                       | ledger     | Normal   | Planned             | Agent | S-01 to prepare  | 2026-09-03   |
| T-16 | Build in-product super-administrator MFA reset                      | ledger     | Normal   | Backlog             | Agent | S-01 to prepare  | not recorded |
| T-17 | Commission high-fidelity design and brand sign-off                  | design     | Low      | Backlog             | Owner | none yet         | not recorded |
| T-18 | Build the six DD84 routines as runnable commands                    | ops        | High     | Done                | Agent | A-08             | 2026-08-06   |
| T-19 | Stand up the operating record and seed it with current state        | ops        | High     | **In Verification** | Agent | A-08             | 2026-08-06   |
| T-20 | Extend the Torque agent definition with the missing spec sections   | ops        | High     | Done                | Agent | A-08             | 2026-08-06   |
| T-21 | Point CLAUDE.md §10 at the commands and the operating record        | ops        | Normal   | Done                | Agent | A-08             | 2026-08-06   |
| T-22 | Verify and push the operations control plane                        | ops        | High     | Done                | Agent | A-08             | 2026-08-06   |
| T-23 | Schedule the six routines and confirm the first firing              | ops        | High     | Blocked             | Owner | owner-held       | 2026-08-08   |
| T-24 | Build the weekly marketing opportunity scan routine                 | ops        | Normal   | Planned             | Agent | S-01 to prepare  | 2026-08-13   |
| T-25 | Build the project status control routine                            | ops        | Normal   | Planned             | Agent | S-01 to prepare  | 2026-08-13   |
| T-26 | Decide what to do about 105 files failing `prettier --check`        | ledger     | Normal   | Planned             | Agent | S-01 to prepare  | 2026-08-13   |

Counts: 14 Done · 2 In Verification · 3 Awaiting Approval · 1 Blocked ·
4 Planned · 2 Backlog.

T-26 was discovered while verifying T-22 and is the register doing its job: a
finding that would otherwise have been mentioned once in a reply and lost.

---

## Open items, by what they are waiting on

| Waiting on                | Tasks                        |
| ------------------------- | ---------------------------- |
| Owner approval            | T-11, T-13, T-14             |
| Owner action (scheduling) | T-23                         |
| Owner confirmation        | T-19                         |
| A seeded or live database | T-06                         |
| Agent execution capacity  | T-15, T-16, T-24, T-25, T-26 |

---

## T-01 — Transcribe the DD84 operations specification into the repository

- **Objective** — Make the owner's governing specification readable, searchable
  and diffable by every agent and human working in the repository.
- **Source** — Owner-supplied PDF specification, July 2026.
- **Workstream** ops · **Priority** High · **Owner** Agent · **Due** 2026-07-31
- **Dependencies** — Owner supplying the PDF.
- **Approval class** — B (internal maintenance), covered by A-01.
- **Execution steps** — Transcribe to `docs/DD84-OPERATIONS-AGENT.md`, preserving
  section numbering; mark the PDF as authoritative.
- **Cost** — none. **Risk** — transcription drift from the PDF; mitigated by the
  header note requiring the file to be updated when the PDF is revised.
- **Expected result** — The full 18-section spec in the repository.
- **Completion evidence** — Commit `6468118`, `docs/DD84-OPERATIONS-AGENT.md`
  (497 lines). Log `OL-0001`.
- **Status** Done · **Next action** — Re-verify against the PDF whenever the
  owner revises it.

## T-02 — Author CLAUDE.md as the repository orientation guide

- **Objective** — Stop each new agent session rediscovering the same three
  traps: the repo name, the absent `main` branch, and the three-layer access
  model.
- **Source** — Owner instruction, 2026-07-31.
- **Workstream** ops · **Priority** High · **Owner** Agent · **Due** 2026-07-31
- **Dependencies** — T-01 for the governance section.
- **Approval class** — B, covered by A-01.
- **Execution steps** — Write the orientation, stack, layout, access model,
  client selection, API conventions, workflow, jobs, testing and conventions
  sections; cross-reference the spec.
- **Cost** — none. **Risk** — documentation drifting from code, which later
  materialised as T-04 and T-10.
- **Expected result** — A single onboarding file that is accurate.
- **Completion evidence** — Commit `6468118`, `CLAUDE.md`. Log `OL-0001`.
- **Status** Done · **Next action** — T-21 adds the operating-system pointer.

## T-03 — Define the Torque agent as a reusable subagent

- **Objective** — Give the operating protocol an executable identity rather than
  leaving it as prose in a spec.
- **Source** — Spec §1 (persona) and §5 (workflow).
- **Workstream** ops · **Priority** High · **Owner** Agent · **Due** 2026-07-31
- **Dependencies** — T-01.
- **Approval class** — B, covered by A-01.
- **Execution steps** — Write `.claude/agents/torque.md` with persona, operating
  sequence, autonomy boundary, approval packet and execution standards.
- **Cost** — none. **Risk** — a definition that states the persona but omits the
  machinery, which is exactly what T-20 later corrected.
- **Expected result** — An invocable agent definition.
- **Completion evidence** — Commit `6468118`, `.claude/agents/torque.md`
  (138 lines). Log `OL-0001`.
- **Status** Done · **Next action** — Superseded in scope by T-20.

## T-04 — Correct documentation that had drifted away from the code

- **Objective** — Remove claims in the docs that the code did not support, so
  that the documentation can be trusted as a source.
- **Source** — Agent review of README, ARCHITECTURE, MILESTONES, RUNBOOK against
  the implementation.
- **Workstream** ledger · **Priority** Normal · **Owner** Agent · **Due** 2026-07-31
- **Dependencies** — none.
- **Approval class** — B, covered by A-02.
- **Execution steps** — Diff each claim against the code; correct or delete the
  ones that failed; state the residual honestly.
- **Cost** — none. **Risk** — none material; documentation-only.
- **Expected result** — Documentation that matches the code.
- **Completion evidence** — Commit `a489144`, five files, +122/−57. Log `OL-0002`.
- **Status** Done · **Next action** — Recurrence handled by T-10.

## T-05 — Record the true legal-review flags on the ten legal documents

- **Objective** — Make the review status of each legal document explicit rather
  than implied, so the launch blocker is visible.
- **Source** — Review of `src/lib/legal/documents.ts` against
  `docs/MILESTONES.md`.
- **Workstream** compliance · **Priority** High · **Owner** Agent · **Due** 2026-07-31
- **Dependencies** — none.
- **Approval class** — A (record-keeping only — no legal determination made),
  covered by A-02.
- **Execution steps** — Set `requiresReview` truthfully on all ten; record in
  MILESTONES that seven carry the banner and that the exemption claimed for the
  other three is undocumented.
- **Cost** — none. **Risk** — the exemption for editorial standards, corrections
  policy and data source policy is a defensible reading, **not a legal
  determination**, and is not Torque's to make.
- **Expected result** — Seven documents render the "awaiting legal review"
  banner; the exemption question is written down.
- **Completion evidence** — Commit `a489144`, `src/lib/legal/documents.ts`,
  `docs/MILESTONES.md` item 2. Log `OL-0002`.
- **Status** Done · **Next action** — **T-13** takes the question to counsel.

## T-06 — Exclude demo accounts from subscriber, revenue and analytics counts

- **Objective** — Stop the admin dashboard, MRR and the analytics aggregate from
  reporting seeded demo accounts as real business. An inflated subscriber count
  is a number the owner would make decisions on.
- **Source** — Agent finding while reviewing `scripts/seed.ts` against the admin
  dashboard queries.
- **Workstream** finance · **Priority** High · **Owner** Agent · **Due** 2026-08-08
- **Dependencies** — none for the code; a seeded database for verification.
- **Approval class** — **E-adjacent** (changes owner-facing revenue reporting).
  Approved under **A-03**, 2026-07-31.
- **Execution steps** — (1) `src/lib/analytics/sample-data.ts` with the
  exclusion predicate and the filter builders; (2) apply to the subscriber,
  revenue and — under T-09's commit — failed-payment tiles; (3) apply to the
  `aggregate-analytics` job; (4) badge sample rows in the UI and carry the flag
  into CSV exports; (5) 13 unit tests, extended to 16 by the failed-payment tile.
- **Cost** — none. **Risk** — the two exclusion helpers are deliberately
  asymmetric because `analytics_events.user_id` is nullable and a null means real
  anonymous traffic; unifying them would make one tile wrong. Pinned by tests.
- **Expected result** — Dashboard subscriber count, MRR and failed-payment tile
  count only real accounts.
- **Completion evidence** — Commits `1039582` and `8337e41`; tests
  `tests/unit/analytics/sample-data.test.ts` pass. Logs `OL-0003`, `OL-0005`.
- **Verification gap** — **The rendered numbers have never been observed against
  a database.** Unit tests pin the filter _shape_, not the result. Nothing in
  this repository has run against a live or seeded Supabase instance.
- **Status** **In Verification** · **Next action** — `supabase start`,
  `supabase db reset`, `npm run db:seed`, then read `/admin` and confirm the
  subscriber count and MRR both read zero with only demo accounts present.
  Record the observation in `OPERATING-LOG.md`; only then does this move to Done.

## T-07 — Count annual subscribers at a twelfth of the annual price

- **Objective** — Report monthly recurring revenue truthfully. Counting an
  annual subscriber at the monthly price overstated MRR.
- **Source** — Agent review of the admin dashboard revenue tile.
- **Workstream** finance · **Priority** High · **Owner** Agent · **Due** 2026-07-31
- **Dependencies** — T-06 (shares the dashboard query path).
- **Approval class** — E-adjacent. Approved under **A-04**, 2026-07-31.
- **Execution steps** — Extract the arithmetic into `src/lib/billing/mrr.ts`;
  normalise every interval to a monthly figure; cover with fixtures.
- **Cost** — none. **Risk** — rounding at the cent boundary; covered by tests.
- **Expected result** — MRR is interval-correct.
- **Completion evidence** — Commit `5ae44fa`; 18 tests in
  `tests/unit/billing/mrr.test.ts` pass. Log `OL-0004`.
- **Status** Done — the success test was "the arithmetic matches hand-calculated
  fixtures across intervals", and it does. **Reconciliation against live Stripe
  data is a different test and belongs to T-11**, not to this task.
- **Next action** — none; folded into T-11's payment matrix.

## T-08 — Remove the phantom integration-test glob from the Vitest config

- **Objective** — Stop the test configuration implying a layer of coverage that
  has never existed.
- **Source** — Agent review of `vitest.config.ts` against the filesystem.
- **Workstream** ledger · **Priority** Normal · **Owner** Agent · **Due** 2026-08-02
- **Dependencies** — none.
- **Approval class** — B, covered by S-01.
- **Execution steps** — Drop `tests/integration/**` from `include`; record in the
  config why it was removed rather than filled.
- **Cost** — none. **Risk** — none; the directory never existed.
- **Expected result** — `npm test` claims only the coverage it has.
- **Completion evidence** — Commit `8337e41`, `vitest.config.ts`. Log `OL-0005`.
- **Status** Done · **Next action** — If a database-backed suite is ever written,
  it gets its own directory, glob and script.

## T-09 — Close the PostgREST filter injection in the opportunity fallback

- **Objective** — Remove a filter-injection pattern from the API surface before
  it is copied into a route where the blast radius is not small.
- **Source** — Agent security review of the API surface.
- **Workstream** ledger · **Priority** High · **Owner** Agent · **Due** 2026-08-02
- **Dependencies** — none.
- **Approval class** — B, covered by S-01.
- **Execution steps** — Replace the interpolated `.or()` in
  `src/app/api/v1/opportunities/[idOrSlug]/route.ts` with a column choice bound
  to the value; export `isOpportunityId` from `query.ts` so both lookups
  discriminate identically.
- **Cost** — none. **Risk assessment recorded at the time** — the target,
  `opportunity_previews`, is already granted to anon, already restricted to
  published non-restricted rows, and carries no analysis, financial, eligibility
  or source-URL field. This was a malformed-query and unintended-row-match bug,
  **not a disclosure one**. Fixed because the pattern gets copied.
- **Expected result** — A crafted path segment is treated as a value.
- **Completion evidence** — Commit `8337e41`; the same commit records the parts
  of the surface reviewed and found correct, so they are not re-reviewed.
  Log `OL-0005`.
- **Status** Done · **Next action** — none.

## T-10 — Correct the test counts and integration-suite claim in CLAUDE.md

- **Objective** — Keep the one file every agent reads first accurate about what
  the test suite actually is.
- **Source** — Agent verification of CLAUDE.md against a real `npm test` run.
- **Workstream** ops · **Priority** Normal · **Owner** Agent · **Due** 2026-08-05
- **Dependencies** — T-08.
- **Approval class** — B, covered by S-01.
- **Execution steps** — Run the suite; write the real counts; remove the
  integration-suite claim.
- **Cost** — none. **Risk** — none.
- **Expected result** — CLAUDE.md states 179 tests in 11 files.
- **Completion evidence** — Commit `3d22acc`. Log `OL-0006`.
- **Status** Done · **Next action** — Any change to the suite updates this line
  in the same commit.

## T-11 — Create Stripe products and prices and run the test-payment matrix

- **Objective** — Unblock billing. Nothing can be sold until the products exist
  and the tier-by-tier payment matrix has been run.
- **Source** — `docs/MILESTONES.md` "What is still not built", item 1.
- **Workstream** finance · **Priority** **Critical** · **Owner** Owner ·
  **Due** 2026-08-20 (proposed)
- **Dependencies** — A Stripe account with live and test keys; owner decision on
  final pricing.
- **Approval class** — **E (financial) and F (system change)**. Blocked on
  **A-05**, pending.
- **Execution steps (prepared, not executed)** — (1) Create four products and
  eight prices (monthly and annual per tier) in Stripe **test mode** first;
  (2) populate `stripe_monthly_price_id` / `stripe_annual_price_id` on
  `subscription_plans`; (3) run checkout for each tier with test cards, plus
  upgrade, downgrade, cancel-at-period-end, past-due and reactivation;
  (4) confirm each webhook lands one `billing_events` row and the right
  `effectiveAccessRank`; (5) repeat the read-only checks in live mode.
- **Cost** — Stripe fees on test transactions are zero; live-mode verification
  costs the processing fee on any real charge made to test it.
- **Risk** — Wrong price IDs silently grant the wrong rank. Rollback: prices can
  be archived, not deleted; the plan rows can be reverted to null.
- **Expected result** — Every tier is purchasable and the granted rank matches.
- **Completion proof required** — Stripe dashboard product and price IDs, one
  `billing_events` row per event, a screenshot of each tier's billing page.
- **Status** Awaiting Approval · **Next action** — Owner answers A-05.

## T-12 — Record the sample-data exclusion rule in CLAUDE.md

- **Objective** — Stop a future agent "cleaning up" the demo-data exclusion and
  silently reinflating the subscriber count and MRR.
- **Source** — T-06.
- **Workstream** ops · **Priority** Normal · **Owner** Agent · **Due** 2026-07-31
- **Dependencies** — T-06.
- **Approval class** — B, covered by A-03.
- **Execution steps** — Add the rule to the CLAUDE.md data-honesty section,
  including the one deliberate exception: `reports_read` lets `is_sample = true`
  bypass the rank check so a demo report displays at every tier.
- **Cost** — none. **Risk** — none.
- **Expected result** — The exclusion is documented as intentional.
- **Completion evidence** — Commit `1039582`, CLAUDE.md §9. Log `OL-0003`.
- **Status** Done · **Next action** — none.

## T-13 — Commission legal review of the ten legal and policy documents

- **Objective** — Clear the hard launch blocker. Seven documents render an
  "awaiting legal review" banner and three claim an undocumented exemption.
- **Source** — `docs/MILESTONES.md` item 2; T-05.
- **Workstream** compliance · **Priority** **Critical** · **Owner** Owner ·
  **Due** 2026-08-27 (proposed)
- **Dependencies** — Owner engaging counsel; a budget.
- **Approval class** — **G (legal)**. Blocked on **A-06**, pending.
  **Torque makes no legal determination and gives no legal advice.**
- **Execution steps (prepared, not executed)** — (1) Export the ten documents
  from `src/lib/legal/documents.ts` into a review pack; (2) attach the specific
  question for each — for terms, privacy, subscription terms, refunds, cookies,
  copyright and disclaimers, "is this fit to publish"; for editorial standards,
  corrections policy and data source policy, "are these genuinely exempt as
  descriptions of our own practice rather than agreements with the member";
  (3) record counsel's answer per document; (4) flip `requiresReview` only on a
  recorded answer.
- **Cost** — Counsel fee, **not recorded** — obtaining a quote is part of A-06.
- **Risk** — Launching on unreviewed terms is a legal and reputational exposure.
  The exemption claimed for the three is a reading, not an opinion.
- **Expected result** — Every document either reviewed or documented as exempt
  **by counsel**, not by the agent.
- **Completion proof required** — Written response from counsel per document.
- **Status** Awaiting Approval · **Next action** — Owner answers A-06.

## T-14 — Wire virus scanning to `attachments.scan_status`

- **Objective** — Stop accepting member uploads into a column that says
  `pending` forever.
- **Source** — `docs/MILESTONES.md` item 3.
- **Workstream** ledger · **Priority** High · **Owner** Owner ·
  **Due** 2026-09-03 (proposed)
- **Dependencies** — Choice of scanning service; a paid subscription.
- **Approval class** — **E (recurring spend)** and **F (integration)**. Blocked
  on **A-07**, pending.
- **Execution steps (prepared, not executed)** — (1) Compare candidate scanners
  on price, file-size ceiling, latency and retention; (2) wire the storage hook
  to set `scan_status` to `clean` or `infected`; (3) gate download on `clean`;
  (4) alert an administrator on `infected`; (5) test with the EICAR string.
- **Cost** — Recurring, **not recorded** until A-07 selects a vendor.
- **Risk** — An unscanned upload distributed to members. Interim mitigation is
  that uploads are namespaced by user id in the storage policy.
- **Expected result** — No attachment is downloadable until scanned clean.
- **Completion proof required** — An EICAR upload marked `infected` and blocked;
  a clean file marked `clean` and downloadable.
- **Status** Awaiting Approval · **Next action** — Owner answers A-07.

## T-15 — Make the public landing pages cacheable again

- **Objective** — Restore caching on the marketing routes, which currently
  render per request because the marketing layout renders a session-aware header.
- **Source** — `docs/MILESTONES.md` item 5.
- **Workstream** ledger · **Priority** Normal · **Owner** Agent ·
  **Due** 2026-09-03 (proposed)
- **Dependencies** — none to prepare; a deploy needs approval.
- **Approval class** — A to prepare (S-01); **F to deploy**.
- **Execution steps** — Move the auth-dependent part of the header into a client
  component or adopt partial prerendering; confirm the marketing loaders still
  use `db/public.ts` and stay cookie-free; verify `revalidate` takes effect.
- **Cost** — none. **Risk** — a bodged fix that swallows Next.js's
  `DynamicServerError` produces a permanently blank homepage with nothing
  logged. That failure has happened here before; it is why `db/public.ts` exists.
- **Expected result** — Marketing routes render statically with a working
  session-aware header.
- **Completion proof required** — Build output showing the routes as static, and
  a signed-in header still correct in the browser.
- **Status** Planned · **Next action** — Schedule after T-11 and T-13; neither
  blocks it, but both outrank it.

## T-16 — Build in-product super-administrator MFA reset

- **Objective** — Remove the need to touch Supabase directly when a staff member
  loses their authenticator.
- **Source** — `docs/MILESTONES.md` item 6.
- **Workstream** ledger · **Priority** Normal · **Owner** Agent ·
  **Due** not recorded
- **Dependencies** — none.
- **Approval class** — A to prepare (S-01); **F to deploy** — it changes an
  authentication path.
- **Execution steps** — Design the reset flow described on `/admin/security`;
  require a second super-administrator; write an audit entry on every reset.
- **Cost** — none. **Risk** — an MFA reset path is an account-takeover path if
  it is not itself gated. Two-person rule is not optional here.
- **Expected result** — A super-administrator can reset a colleague's second
  factor, audited.
- **Completion proof required** — A reset performed in a local environment, with
  the `audit_logs` row.
- **Status** Backlog · **Next action** — Size it after launch blockers clear.

## T-17 — Commission high-fidelity design and brand sign-off

- **Objective** — Close milestone 1, which is partial: a working design system
  exists, but there is no confirmed brand direction or owner sign-off.
- **Source** — `docs/MILESTONES.md` milestone 1 and item 4.
- **Workstream** design · **Priority** Low · **Owner** Owner ·
  **Due** not recorded
- **Dependencies** — Owner decision; a budget; possibly an external designer.
- **Approval class** — **E** if it involves spend. No packet raised yet — it is
  below the launch blockers and raising it now would spend owner attention on
  the wrong decision.
- **Execution steps** — not yet scoped.
- **Cost** — not recorded. **Risk** — none operational; a launch-quality risk.
- **Expected result** — A signed-off brand direction.
- **Status** Backlog · **Next action** — Raise a packet once T-11 and T-13 are
  answered.

## T-18 — Build the six DD84 routines as runnable commands

- **Objective** — Turn spec §16 from a table of intentions into six commands
  that actually run.
- **Source** — Owner instruction, 2026-08-06.
- **Workstream** ops · **Priority** High · **Owner** Agent · **Due** 2026-08-06
- **Dependencies** — T-19 for the files they write into.
- **Approval class** — B, covered by **A-08**.
- **Execution steps** — Write `.claude/commands/dd84-{daily-brief,inbox-intake,
followup,cash-review,opportunity-scan,site-monitor}.md`; each states its
  objective, its connectors and the exact tool calls, its output format, where it
  writes, what it may never do without approval, and its degradation rule.
- **Cost** — none. **Risk** — a routine that fabricates a section when a
  connector is missing would be worse than no routine at all; the degradation
  rule is stated in every file and in the shared contract in `README.md`.
- **Expected result** — Six invocable commands, all Class A.
- **Completion evidence** — Six files in `.claude/commands/`. Log `OL-0007`.
- **Status** Done · **Next action** — T-23 schedules them; the first live run of
  each is the real test, since none has yet run against a connector.

## T-19 — Stand up the operating record and seed it with current state

- **Objective** — Give the register, the approvals and the execution log a home
  on disk, so operational state survives the end of a conversation.
- **Source** — Owner instruction, 2026-08-06; spec §3 and §9.
- **Workstream** ops · **Priority** High · **Owner** Agent · **Due** 2026-08-06
- **Dependencies** — none.
- **Approval class** — B, covered by **A-08**.
- **Execution steps** — Create `docs/ops/` with `README.md`,
  `TASK-REGISTER.md`, `APPROVALS.md`, `OPERATING-LOG.md` and `briefs/`; seed each
  from repository evidence and the owner's stated statuses.
- **Cost** — none. **Risk** — **a seeded register that is wrong is worse than an
  empty one**, because everything downstream trusts it.
- **Expected result** — Three linked files that a routine can read and update.
- **Completion evidence** — This directory. Log `OL-0007`.
- **Verification gap** — The register was reconstructed from git history,
  `MILESTONES.md` and the owner's stated statuses. **Torque cannot confirm from
  inside the repository that no task is missing** — work that was discussed but
  never touched a file leaves no trace here.
- **Status** **In Verification** · **Next action** — Owner reads the summary
  table and confirms it matches their own record, or names what is missing.
  Only then does this move to Done.

## T-20 — Extend the Torque agent definition with the missing spec sections

- **Objective** — Make the agent definition operationally complete: it stated
  the persona and the boundary but not the task fields, the prioritisation
  factors or the escalation table.
- **Source** — Owner instruction, 2026-08-06; spec §4, §10, §14.
- **Workstream** ops · **Priority** High · **Owner** Agent · **Due** 2026-08-06
- **Dependencies** — T-19 for the pointer target.
- **Approval class** — B, covered by **A-08**.
- **Execution steps** — Add the §4 field list, the §10 prioritisation factors,
  the §14 escalation table and a pointer to `docs/ops/`, keeping the file a
  working document rather than a copy of the spec.
- **Cost** — none. **Risk** — bloating the definition until it is not read.
- **Expected result** — A definition that answers "what do I do when X" without
  opening the spec.
- **Completion evidence** — `.claude/agents/torque.md`. Log `OL-0007`.
- **Status** Done · **Next action** — Revisit whenever the PDF spec is revised.

## T-21 — Point CLAUDE.md §10 at the commands and the operating record

- **Objective** — Make the operating system discoverable from the file every
  agent reads first.
- **Source** — Owner instruction, 2026-08-06, which explicitly authorised this
  one CLAUDE.md edit.
- **Workstream** ops · **Priority** Normal · **Owner** Agent · **Due** 2026-08-06
- **Dependencies** — T-18, T-19.
- **Approval class** — B, covered by **A-08**, with the stated limit: additive
  only, §10 only, and §11 and the existing §10 protocol text untouched.
- **Execution steps** — Append a short subsection to §10 listing the commands
  and the three operating-record files.
- **Cost** — none. **Risk** — scope creep into the rest of CLAUDE.md; bounded by
  the approval limit and checked in the diff.
- **Expected result** — A reader of CLAUDE.md finds the routines.
- **Completion evidence** — CLAUDE.md §10 diff. Log `OL-0007`.
- **Status** Done · **Next action** — none.

## T-22 — Verify and push the operations control plane

- **Objective** — Prove the change is green and land it on the working branch.
- **Source** — Owner instruction, 2026-08-06.
- **Workstream** ops · **Priority** High · **Owner** Agent · **Due** 2026-08-06
- **Dependencies** — T-18, T-19, T-20, T-21.
- **Approval class** — B for the branch push, covered by **A-08** and CLAUDE.md
  §11. **No pull request** — that boundary is not crossed.
- **Execution steps** — `npm run format` over the new markdown;
  `npm run typecheck && npm run lint && npm test`; commit; push to
  `claude/claude-md-docs-jjveuq`.
- **Cost** — none. **Risk** — a markdown-only change should not move the suite;
  if it does, the change is wrong and is reverted rather than explained away.
- **Expected result** — 179 tests in 11 files still pass; the branch is updated.
- **Completion proof required** — Real command output and the pushed commit hash,
  recorded in `OPERATING-LOG.md` **after** the push, not before.
- **Completion evidence** — Logs `OL-0008` (verification) and `OL-0009` (push).
  Commit `fd50a82`; `origin/claude/claude-md-docs-jjveuq` confirmed at the same
  hash after a fetch, rather than inferred from the push output. Typecheck
  clean, lint clean, 179 tests in 11 files passing.
- **Status** Done · **Next action** — T-23: the owner schedules the routines.
  A run of `/dd84-daily-brief` against real connectors is the first genuine test
  of T-18, and nothing here has had one yet.

## T-23 — Schedule the six routines and confirm the first firing

- **Objective** — Get the routines running on a cadence rather than on demand.
- **Source** — Owner instruction, 2026-08-06: "Do not create scheduled triggers
  yourself. I am handling scheduling."
- **Workstream** ops · **Priority** High · **Owner** **Owner** · **Due** 2026-08-08
- **Dependencies** — T-18.
- **Approval class** — Owner-held. **Torque must not create its own schedule.**
- **Execution steps (owner)** — Create a trigger per routine at the cadence in
  `docs/ops/README.md`; confirm the first firing writes a brief and an operating
  log entry.
- **Cost** — none. **Risk** — a routine that fires but writes nothing looks like
  a routine that found nothing. The first firing must be checked for a log entry,
  not just for output.
- **Expected result** — Six scheduled routines, each with a first run recorded.
- **Completion proof required** — One `OL-` entry per routine's first firing.
- **Status** In Verification · **Next action** — Confirm the next scheduled run
  writes a brief. **Partly done, 2026-08-13.** The owner scheduled four of the
  six routines — daily brief, inbox intake, cash review and opportunity scan —
  on 2026-08-07. Follow-up and site monitor are still unscheduled. All four were
  repointed at the merged branch under A-09 (OL-0011). **The completion proof is
  still missing:** this task requires one `OL-` entry per routine's first
  firing, and no routine run has yet written one. See T-27 — that gap is now its
  own task, and T-23 cannot close until it is resolved.

## T-24 — Build the weekly marketing opportunity scan routine

- **Objective** — Close the gap between spec §16's eight routines and the six
  that exist.
- **Source** — Spec §16; gap identified while executing T-18.
- **Workstream** ops · **Priority** Normal · **Owner** Agent · **Due** 2026-08-13
- **Dependencies** — Confirmation of which advertising accounts exist, which
  Supermetrics can answer, and which are authorised.
- **Approval class** — A to build; the routine itself will be Class A.
- **Execution steps** — Ranked campaigns, partnerships, offers, content and
  outreach tied to capacity and measurable revenue, per spec §8.3; read spend and
  conversion through Supermetrics; **prepare, never publish**.
- **Cost** — none to build. **Risk** — recommending spend without capacity data
  produces leads the shop cannot service.
- **Expected result** — `.claude/commands/dd84-marketing-scan.md`.
- **Status** Planned · **Next action** — Confirm the authorised ad accounts
  first; building it against imagined accounts is how a routine learns to invent.

## T-25 — Build the project status control routine

- **Objective** — The eighth spec §16 routine: active builds, software projects,
  product development and equipment purchases reviewed for milestones, blockers,
  costs and decisions.
- **Source** — Spec §16 and §8.7.
- **Workstream** ops · **Priority** Normal · **Owner** Agent · **Due** 2026-08-13
- **Dependencies** — A project record per active build. None exists yet; the
  register currently holds software tasks only.
- **Approval class** — A to build; the routine itself will be Class A.
- **Execution steps** — Read the register, GitHub milestones and the project
  records; report milestone, blocker, budget variance, scope change and the next
  owner decision per project.
- **Cost** — none. **Risk** — reporting on projects that have no record produces
  an empty report that looks like a healthy one.
- **Expected result** — `.claude/commands/dd84-project-review.md`.
- **Status** Planned · **Next action** — Create the first project record — the
  vehicle builds and product-development work in spec §8.7 are not represented
  in this register at all, which is itself a finding.

## T-26 — Decide what to do about 105 files failing `prettier --check`

- **Objective** — Resolve a discrepancy between what the repository says about
  its own formatting and what `npm run format:check` actually reports.
- **Source** — Agent finding while running the verification chain for T-22 on
  2026-08-06.
- **Workstream** ledger · **Priority** Normal · **Owner** Agent ·
  **Due** 2026-08-13 (proposed)
- **Dependencies** — none.
- **Approval class** — A to investigate (S-01). A reformat touching 105 files is
  a large diff over code nobody is changing, so **the decision to run it is the
  owner's**, not a side effect of some other task.
- **The finding, precisely** — `npm run format:check` reports 105 files with
  style issues: effectively the whole `src/` tree, the unit tests, `scripts/`
  and `vercel.json`. **This is pre-existing.** It was confirmed by stashing the
  operations-control-plane change and re-running the check against clean `HEAD`
  (`3d22acc`), where `src/lib/scoring/score.ts` still fails. Every markdown file
  added or changed by T-18 to T-21 passes.
- **Most likely cause, not yet confirmed** — a version difference in
  `prettier-plugin-tailwindcss` or Prettier itself between whoever last ran
  `npm run format` and the currently installed dependency tree. That is a guess
  and is labelled as one; step 1 confirms or kills it.
- **Execution steps** — (1) Compare the installed Prettier and plugin versions
  against the lockfile and identify what the reformat would actually change —
  class reordering, or something substantive; (2) sample three diffs and show
  them to the owner; (3) on approval, run `npm run format` as a **single
  mechanical commit that touches nothing else**, so it can be skipped in
  `git blame`; (4) confirm `typecheck`, `lint` and `test` are unchanged after.
- **Cost** — none. **Risk** — low, but a 105-file diff buries any real change
  landing beside it, which is the whole reason it gets its own commit.
- **Expected result** — Either a clean `format:check`, or a recorded decision
  that the repository does not enforce it and the script says so.
- **Completion proof required** — `npm run format:check` exiting clean, with the
  three test commands still green, or the recorded decision.
- **Status** Planned · **Next action** — Step 1. **Not fixed during T-22**:
  reformatting 105 unrelated files while landing the operations control plane
  would be silent scope expansion, which §11 of the spec forbids.

## T-27 — Routines fire but commit nothing

- **Objective** — Find out why four scheduled routines have run for a week
  without writing a single brief, and make the next run leave evidence.
- **Source** — Agent finding while executing A-09 on 2026-08-13.
- **Workstream** ops · **Priority** **High** · **Owner** Agent ·
  **Due** 2026-08-15
- **Dependencies** — none. It blocks T-23.
- **Approval class** — A. Diagnosis reads logs and repository state; it changes
  no live system. Any fix that alters a Routine's schedule or permissions comes
  back to the owner, since A-09's grant was consumed on execution.
- **The finding, precisely** — `list_triggers` reports `last_fired_at` values
  through 2026-08-13 for all four Torque Routines: the daily brief at 10:50 UTC
  and the inbox intake at 10:25 UTC that morning, the opportunity scan on
  2026-08-10, the cash review on 2026-08-07. Against that,
  `git log -- docs/ops/` on the merged branch shows exactly two commits, both
  written by hand during T-22, and `docs/ops/briefs/` contains only its README.
  **Zero briefs exist.** The routines are being invoked and producing nothing
  that survives the session.
- **Updated 2026-08-28. Two more weeks of the same.** Every routine has kept
  firing on schedule and every run reports `ROUTINE_RUN_STATUS_SUCCEEDED` —
  inbox intake as recently as 2026-08-28 10:20, the daily brief 2026-08-27,
  the opportunity scan 2026-08-24, the cash review 2026-08-21. The newest commit
  on the branch is still a hand-written one. **`SUCCEEDED` means the session
  finished, not that it delivered.**

### Root cause — confirmed 2026-08-28

**The fired sessions have no repository attached.** They are created without a
git source and without an outcome branch, so there is nothing to commit to and
nothing to push with. The agent does the work and has nowhere to put it.

The evidence, in the order that settles it:

1. **The fired session's own record.** `get_session` on the 2026-08-28 inbox
   intake (`cse_01G1uzjS1oNsmD3ZCvVq8FQx`) returns a `session_context` of exactly
   `{autofix_on_pr_create, permission_mode}` — **no `sources`, no `outcomes`**.
   The 2026-08-27 daily brief (`cse_01X8sfFM64UdniNEnDZJMMtx`) is the same.
2. **The control.** The one Routine on this account that _does_ carry
   `sources` and `outcomes` in its session context is
   _Weekly Georgia Opportunity Ledger summary_ — the only one with
   `created_via: http_api`, i.e. created from the claude.ai Routines UI. The four
   that deliver nothing are all `created_via: meta_mcp`.
3. **The tool cannot express it.** `create_trigger` has no `source_url` or
   `outcome_branch` parameter, and `update_trigger` accepts only `name`,
   `prompt`, `cron_expression`, `run_once_at`, `enabled` and `model`. **So this
   cannot be repaired by editing the existing Routines** — the missing thing is
   not in the editable surface.
4. **It is not permissions and not a prompt fault.** Both sampled sessions ran
   with `permission_mode: auto`, and both did the work: the 2026-08-28 run spent
   **$1.77 and produced 22,888 output tokens**, the 2026-08-27 run $0.86 and
   13,824. That is a written brief in each case. It went into the reply and died
   with the session.

**This is the same root cause as the connector gap** recorded in
`docs/agents/README.md`: a Routine minted through the MCP tool is impoverished
relative to one minted in the claude.ai UI — no connectors, and no repository.
One remedy fixes both.

- **Cost of leaving it** — real and recurring. Two sampled runs cost $2.63
  between them and produced nothing that survives. The routines have fired on
  this pattern since 2026-08-07. **No total is claimed here** — only the sampled
  runs were read, and a number without a source is a defect.
- **Risk** — the schedule reads as coverage that does not exist. That is worse
  than no automation, because it invites someone to trust an operating record
  that was never written.
- **The fix is the owner's, and there are two.** Recorded as **A-10**.
  **Recommended:** recreate the four Routines from the claude.ai Routines UI with
  the repository and branch attached — one trip, and it fixes the connector gap
  at the same time, which is most of what the cash review and inbox intake are
  for. **Alternative:** rebind them to fire into a persistent session that
  already holds the checkout via `create_trigger`'s `persistent_session_id`.
  That is inside the agent's reach but fragile — it depends on one session
  surviving, and its context grows without bound.
- **Expected result** — One scheduled run that ends with a dated brief committed
  to `docs/ops/briefs/` and an entry in `OPERATING-LOG.md`.
- **Completion proof required** — The commit hash of a routine-written brief.
- **Status** **Blocked (on owner)** · **Next action** — A-10. Diagnosis is
  complete; the remedy is outside the agent's authority and, for the recommended
  option, outside its tools.

## T-28 — Consolidate the Ledger onto one repository

- **Objective** — End the two-copy split between `tune-advisor-` and
  `georgia-opportunity-ledger`, with the agent platform living alongside the
  application it governs.
- **Source** — Write access granted by the owner, 2026-09-09; divergence found
  on inspection the same day.
- **Workstream** ledger · **Priority** High · **Owner** Agent · **Due** 2026-09-09
- **Dependencies** — none.
- **Approval class** — G in effect (it changes which repository is authoritative).
  Approved as **A-11**.
- **What the divergence actually was** — `georgia-opportunity-ledger` was ahead
  on the application: 31 migrations to 27, the attachment scanner wired end to
  end, in-product super-administrator MFA reset, an accessibility audit, and a
  Netlify deployment generating its scheduled functions from the job registry.
  `tune-advisor-` was ahead on everything agent-related and on four modules —
  `mrr.ts`, `sample-data.ts`, `upgrade-source.ts`, `member-header.tsx`.
- **A correction this produced** — `docs/MILESTONES.md` as carried in
  `tune-advisor-` listed virus scanning and the super-administrator MFA reset as
  not built. **Both were built here.** The canonical repo's own MILESTONES was
  already accurate; the stale document was the one the agent had been reading and
  quoting. No edit was needed here — the record simply moved to the accurate copy.
- **What was deliberately not ported** — `member-header.tsx`. This repository's
  `SiteHeader` already takes an optional resolved session and defers to
  `header-session.tsx` in the browser, which is the same caching fix arrived at
  independently. Copying it would have left two mechanisms for one job.
- **Execution steps** — (1) compare both trees file by file; (2) port and **wire**
  the three genuinely missing modules; (3) port the agent platform; (4) rewrite
  CLAUDE.md for this repository's real facts; (5) run the gate; (6) push a branch.
- **Cost** — none. **Risk** — the main one was porting duplicate machinery, which
  step 1 was there to catch, and did.
- **Expected result** — One repository holding both the application and the
  agents, with the gate green.
- **Completion proof required** — The commit hash, with typecheck, lint and test
  output.
- **Status** **Done**, 2026-09-09 · Evidence: OL-0013, commit `00575a3` on
  `claude/consolidate-agent-platform`, with typecheck silent, lint clean and 240
  tests passing in 18 files. Routines repointed under OL-0014.
