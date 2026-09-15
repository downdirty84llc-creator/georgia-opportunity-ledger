# DD84 operating log

Append-only execution record, in the fields required by
`docs/DD84-OPERATIONS-AGENT.md` §9: timestamp, action, tool, source, operator,
before/after state, evidence, error and remediation.

**Rules.**

- **Append only.** No entry is ever edited or deleted, including one that records
  a mistake. A wrong entry is corrected by a later entry that references it —
  the same discipline the `audit_logs` table enforces in the product, where
  there is deliberately no update or delete policy for anyone.
- One entry per action that changed something, plus one per routine run — a run
  that found nothing still gets an entry. Silence in this file must mean "did not
  run", never "ran and found nothing".
- Evidence is a commit hash, a confirmation number, a URL, a query result or
  real command output. "Completed successfully" is not evidence.
- Timestamps are UTC.
- Entry IDs are sequential: `OL-nnnn`.

**Seeded 2026-08-06.** Entries OL-0001 to OL-0006 are reconstructed from
`git log` on `claude/claude-md-docs-jjveuq`; their timestamps are the real commit
timestamps and the evidence is verifiable with `git show`. The owner's brief
described five landed commits; the branch carries six since the platform build.
The sixth, `3d22acc`, was a small follow-up correcting the documentation written
in `8337e41`. It is logged as it is rather than as it was described.

---

## OL-0001 — Adopt the DD84 specification into the repository

- **Timestamp** 2026-07-31T10:55:18Z
- **Task** T-01, T-02, T-03 · **Approval** A-01
- **Action** Added `docs/DD84-OPERATIONS-AGENT.md`, `CLAUDE.md` and
  `.claude/agents/torque.md`.
- **Tool** Local file write; `git commit`
- **Source** Owner-supplied PDF specification, July 2026
- **Operator** Torque (agent)
- **Before** No governance documents in the repository; no agent definition.
- **After** Three files, 1,106 lines added.
- **Evidence** Commit `6468118`
- **Error** None
- **Remediation** n/a

## OL-0002 — Correct documentation that had drifted away from the code

- **Timestamp** 2026-07-31T11:17:45Z
- **Task** T-04, T-05 · **Approval** A-02
- **Action** Corrected README, ARCHITECTURE, MILESTONES and RUNBOOK; set the
  `requiresReview` flags truthfully in `src/lib/legal/documents.ts`.
- **Tool** Local file edit; `git commit`
- **Source** Agent review of documented claims against the implementation
- **Operator** Torque (agent)
- **Before** Documentation asserted behaviour the code did not have; legal
  documents did not declare their review state.
- **After** Five files, +122/−57. Seven legal documents now render the "awaiting
  legal review" banner.
- **Evidence** Commit `a489144`
- **Error** None
- **Remediation** The exemption claimed for three legal documents was recorded as
  an open question rather than resolved. Follow-up task T-13, packet A-06.

## OL-0003 — Exclude demo accounts from subscriber, revenue and analytics counts

- **Timestamp** 2026-07-31T17:00:01Z
- **Task** T-06, T-12 · **Approval** A-03
- **Action** Added `src/lib/analytics/sample-data.ts`; applied the exclusion to
  the admin dashboard subscriber and revenue tiles and to the
  `aggregate-analytics` job; documented the rule in CLAUDE.md.
- **Tool** Local file edit; Vitest; `git commit`
- **Source** Agent finding: `scripts/seed.ts` writes ten `is_sample` accounts
- **Operator** Torque (agent)
- **Before** Seeded demo accounts counted toward the subscriber total, MRR and
  the analytics aggregate.
- **After** Six files, +274/−27, including 13 new unit tests.
- **Evidence** Commit `1039582`; `tests/unit/analytics/sample-data.test.ts`
- **Error** None
- **Remediation** n/a. **The rendered dashboard numbers were not observed** —
  nothing here has run against a database. T-06 remains In Verification.

## OL-0004 — Normalise annual subscriptions in the MRR calculation

- **Timestamp** 2026-07-31T17:22:11Z
- **Task** T-07 · **Approval** A-04
- **Action** Extracted MRR arithmetic into `src/lib/billing/mrr.ts`; annual
  subscribers now count at a twelfth of the annual price.
- **Tool** Local file edit; Vitest; `git commit`
- **Source** Agent review of the admin revenue tile against plan intervals
- **Operator** Torque (agent)
- **Before** An annual subscriber was counted at the monthly price, overstating
  MRR.
- **After** Four files, +393/−15, including 18 unit tests.
- **Evidence** Commit `5ae44fa`; `tests/unit/billing/mrr.test.ts`
- **Error** None
- **Remediation** n/a

## OL-0005 — Security review of the API surface, and two fixes found by it

- **Timestamp** 2026-08-02T18:48:02Z
- **Task** T-09, T-08, T-06 · **Approval** S-01 (T-08, T-09), A-03 (T-06)
- **Action** Three things. (1) Replaced an interpolated PostgREST `.or()` filter
  in the opportunity detail fallback with a bound column match, exporting
  `isOpportunityId` so both lookups discriminate identically. (2) Extended the
  sample-account exclusion to the failed-payment tile. (3) Dropped the
  `tests/integration/**` glob from the Vitest include.
- **Tool** Local file edit; Vitest; `git commit`
- **Source** Agent security review of the API surface
- **Operator** Torque (agent)
- **Before** A crafted path segment was parsed as filter structure rather than as
  a value; the failed-payment tile counted sample accounts; the test config
  declared a directory that has never existed.
- **After** Seven files, +97/−14, three new tests pinning the rendered filter
  shape.
- **Evidence** Commit `8337e41`. The commit message also records which parts of
  the surface were reviewed and found correct — webhook signature verification,
  constant-time job auth, unsubscribe token length-checking, the error handler's
  opaque body, constant-message password reset, the PATCH column allowlist, the
  export rank cap and the audit-log grant chain — so they are not re-reviewed.
- **Error** None during execution.
- **Remediation** Risk of the injection was assessed and recorded as
  malformed-query rather than disclosure: the target view is already granted to
  anon, already restricted to published non-restricted rows, and carries no paid
  field. Fixed because the pattern gets copied, not because the blast radius was
  large.

## OL-0006 — Correct the test counts and integration-suite claim in CLAUDE.md

- **Timestamp** 2026-08-05T09:28:00Z
- **Task** T-10 · **Approval** S-01
- **Action** Ran the suite and wrote the real figures into CLAUDE.md; removed the
  claim of an integration suite.
- **Tool** `npm test`; local file edit; `git commit`
- **Source** Agent verification of CLAUDE.md against a real run
- **Operator** Torque (agent)
- **Before** CLAUDE.md stated counts that no longer matched, and implied
  integration coverage that does not exist.
- **After** CLAUDE.md states 179 tests in 11 files.
- **Evidence** Commit `3d22acc`
- **Error** None
- **Remediation** n/a

## OL-0007 — Build the operations control plane

- **Timestamp** 2026-08-06T19:18:00Z
- **Task** T-18, T-19, T-20, T-21 · **Approval** A-08
- **Action** Created six routine commands in `.claude/commands/`
  (`dd84-daily-brief`, `dd84-inbox-intake`, `dd84-followup`, `dd84-cash-review`,
  `dd84-opportunity-scan`, `dd84-site-monitor`); created `docs/ops/` with
  `README.md`, `TASK-REGISTER.md`, `APPROVALS.md`, `OPERATING-LOG.md` and
  `briefs/`; extended `.claude/agents/torque.md` with the §4 task fields, the
  §10 prioritisation factors and the §14 escalation table; added one additive
  subsection to CLAUDE.md §10.
- **Tool** Local file write; `npm run format`; `npm run typecheck`;
  `npm run lint`; `npm test`
- **Source** Owner instruction, 2026-08-06
- **Operator** Torque (agent)
- **Before** The agent had an identity but no runnable routines and no durable
  operating state; task and approval state lived in conversation transcripts.
- **After** Six commands and a four-file operating record on disk. **No
  connector was contacted and no live system was read or written** — this was
  entirely a repository change.
- **Evidence** The files themselves; verification output recorded in the next
  entry, **after** the commands were actually run. The register was seeded
  from `git log`, `docs/MILESTONES.md` and the owner's stated statuses; fields
  that could not be sourced from an artifact read `not recorded`.
- **Error** None
- **Remediation** T-19 is held at **In Verification**, not Done: Torque cannot
  confirm from inside the repository that the seeded register is complete. Work
  that was discussed but never touched a file leaves no trace here. Owner
  confirmation closes it.

## OL-0008 — Verify the operations control plane

- **Timestamp** 2026-08-06T19:24:49Z
- **Task** T-22 · **Approval** A-08
- **Action** Ran the verification chain over the change from OL-0007.
- **Tool** `npm run typecheck`, `npm run lint`, `npm test`,
  `npx prettier --check`
- **Source** T-22
- **Operator** Torque (agent)
- **Before** Suite green at `3d22acc`: 179 tests in 11 files.
- **After** Unchanged, as a markdown-only change should leave it.
- **Evidence** — real output:
  - `npm run typecheck` — `tsc --noEmit`, exit 0, no diagnostics.
  - `npm run lint` — `✔ No ESLint warnings or errors`. (Also emits a Next.js
    notice that `next lint` is deprecated and removed in Next.js 16 — pre-existing,
    unrelated to this change, and not acted on here.)
  - `npm test` — `Test Files 11 passed (11)`, `Tests 179 passed (179)`,
    duration 1.67s.
  - `npx prettier --check` over the eleven added and modified markdown files —
    `All matched files use Prettier code style!`
- **Error** None from this change.
- **Remediation** `npm run format:check` across the whole repository fails on
  **105 pre-existing files** — the `src/` tree, the unit tests, `scripts/seed.ts`
  and `vercel.json`. Confirmed pre-existing by stashing this change and
  re-running the check against clean `3d22acc`, where `src/lib/scoring/score.ts`
  still fails. **Not fixed here** — reformatting 105 unrelated files while
  landing this change is silent scope expansion. Raised as **T-26**.

## OL-0009 — Push the operations control plane to the working branch

- **Timestamp** 2026-08-06T19:31:00Z
- **Task** T-22 · **Approval** A-08, and CLAUDE.md §11 for the branch push
- **Action** Committed the thirteen files from OL-0007 and pushed to
  `claude/claude-md-docs-jjveuq`.
- **Tool** `git commit`, `git push`, `git fetch`, `git rev-parse`
- **Source** T-22
- **Operator** Torque (agent)
- **Before** Branch at `3d22acc`, local and remote.
- **After** Branch at `fd50a82`, local and remote. **No pull request was
  opened**, and no other branch was touched — that boundary was not crossed.
- **Evidence** — real output:
  - `git push` — `3d22acc..fd50a82  claude/claude-md-docs-jjveuq -> claude/claude-md-docs-jjveuq`
  - Verified in the destination rather than assumed from the push output: after
    `git fetch origin`, local `HEAD` and `origin/claude/claude-md-docs-jjveuq`
    both read `fd50a8245d5be6db8c8e928c41012b84eeb353d2`.
- **Error** None
- **Remediation** n/a. This entry itself lands in a follow-up commit, because
  a commit cannot contain its own hash — the alternative was writing the hash
  before the push and hoping, which is the exact habit this file exists to break.

---

## OL-0010 — Merge the Rev branch and the Torque branch into one

- **Timestamp** 2026-08-13T14:52:00Z
- **Task** T-23 · **Approval** A-09
- **Action** Merged `origin/claude/claude-md-docs-jjveuq` into
  `claude/claude-md-docs-cqvhy6`, resolved two conflicting files by hand, ran the
  verification chain, and pushed.
- **Tool** `git merge`, `git commit`, `git push`, `npm run typecheck`,
  `npm run lint`, `npm test`, `npx prettier --check`
- **Source** Owner instruction, 2026-08-13.
- **Operator** Claude (agent), acting on both agents' records
- **Before** Two divergent branches from merge base `90ba2f5`. Torque's branch
  carried `src/lib/billing/mrr.ts`, `src/lib/analytics/sample-data.ts`, admin
  fixes and 339 lines of tests that Rev's branch did not have. Rev's branch
  carried six recovered migrations, the public-client caching fix and the upgrade
  telemetry that Torque's did not.
- **After** One branch, `claude/claude-md-docs-cqvhy6`, at merge commit
  `8251ec3`, carrying both. `claude/claude-md-docs-jjveuq` is now stale and is
  an ancestor of the merged tip — nothing on it was lost.
- **Evidence** — real output:
  - Conflicts were confined to two files, `CLAUDE.md` (add/add) and
    `docs/MILESTONES.md`; all source files merged automatically.
  - `CLAUDE.md` resolved to Torque's version, then patched with the facts only
    Rev's side knew: 27 migrations rather than 21, `supabase/stripe-prices.live.sql`,
    the `docs/agents/` and `docs/growth/` trees, and the security note on
    migrations 0022–0027.
  - `docs/MILESTONES.md` resolved by combining both: Rev's Stripe-done and
    attachment-scanning items, with Torque's more precise finding that **ten**
    legal documents exist and **seven** carry `requiresReview: true`.
  - `npm run typecheck` — `tsc --noEmit`, exit 0, no diagnostics.
  - `npm run lint` — `✔ No ESLint warnings or errors`.
  - `npm test` — `Test Files 12 passed (12)`, `Tests 187 passed (187)`,
    duration 1.50s. Both agents' suites run together and both pass.
  - `npx prettier --check CLAUDE.md docs/MILESTONES.md` —
    `All matched files use Prettier code style!`
  - `git push` — `5411c75..8251ec3  claude/claude-md-docs-cqvhy6 -> claude/claude-md-docs-cqvhy6`.
    No pull request was opened; no other branch was pushed to.
- **Error** None.
- **Remediation** The merged `CLAUDE.md` still claimed **179 tests in 11 files**,
  which was true of Torque's branch alone and false of the merge. Corrected to
  **187 tests in 12 files** before committing, against the actual `npm test`
  output rather than by adding the two numbers.

## OL-0011 — Converge the schedule on one branch and retire the overlapping Routine

- **Timestamp** 2026-08-13T15:05:00Z
- **Task** T-23 · **Approval** A-09
- **Action** Updated the four Torque Routines to check out and push to the merged
  branch, and deleted Rev's weekly growth brief Routine.
- **Tool** `update_trigger` ×4, `delete_trigger` ×1, `list_triggers`
- **Source** A-09
- **Operator** Claude (agent)
- **Before** Five DD84 Routines. Four Torque Routines pulled and pushed
  `claude/claude-md-docs-jjveuq`; Rev's weekly brief pulled
  `claude/claude-md-docs-cqvhy6`. Rev's fired Mondays 11:00 UTC, 25 minutes
  before Torque's Monday opportunity scan, reporting much of the same ground.
- **After** Four Routines, all on `claude/claude-md-docs-cqvhy6`. Each prompt now
  carries a branch note explaining that jjveuq is stale, and an explicit
  instruction not to write into `docs/growth/` — the two ledgers stay separate on
  the shared branch.
- **Evidence** — real output. `list_triggers` after the change returns four DD84
  Routines, each with the merged branch in its prompt and `updated_at` on
  2026-08-10–13; `trig_014f6Hv1ccKeGHj8mZ59MB2v` returns
  `deleted trigger trig_014f6Hv1ccKeGHj8mZ59MB2v` and no longer appears.
  Rev's deleted prompt is preserved verbatim in `docs/agents/README.md` so the
  Routine can be recreated.
- **Error** None from the change itself.
- **Remediation** A separate finding, not caused here and not fixed here: the
  four Torque Routines have been firing since 2026-08-07 — most recently
  2026-08-13 at 10:25 and 10:50 UTC — and **`docs/ops/briefs/` still contains
  nothing but its README**. No routine run has ever committed a brief or an
  operating-log entry. This is precisely the failure T-23 named in advance: "a
  routine that fires but writes nothing looks like a routine that found nothing."
  Raised as **T-27**. The two firings that happened today ran against jjveuq,
  before the repoint, so the next scheduled run is the first real test.

---

## OL-0012 — Diagnose why the Routines deliver nothing

- **Timestamp** 2026-08-28T11:05:00Z
- **Task** T-27 · **Approval** none needed — Class A, reads only
- **Action** Established the root cause of four Routines firing on schedule and
  committing nothing, and raised the remedy as A-10. **Nothing was changed.**
- **Tool** `list_triggers`, `get_session` ×2, `git fetch`, `git log`
- **Source** T-27, opened 2026-08-13
- **Operator** Claude (agent)
- **Before** T-27 listed four candidate causes and confirmed none.
- **After** Root cause confirmed: the fired sessions have **no repository
  attached**. Blocked on the owner as A-10, because the fix is outside both the
  agent's authority and its tools.
- **Evidence** — real output:
  - `git log` — newest commit on `claude/claude-md-docs-cqvhy6` is `4e9342a`,
    hand-written. Nothing from any routine run, over three weeks.
  - `list_triggers` — all four fired recently and **all report
    `ROUTINE_RUN_STATUS_SUCCEEDED`**: inbox intake 2026-08-28T10:20, daily brief
    2026-08-27T10:50, opportunity scan 2026-08-24T11:25, cash review
    2026-08-21T11:21.
  - `get_session cse_01G1uzjS1oNsmD3ZCvVq8FQx` (2026-08-28 inbox intake) —
    `session_context` is `{autofix_on_pr_create, permission_mode}`. **No
    `sources`. No `outcomes`.** Usage: `cost_usd 1.7659456`,
    `output_tokens 22888`.
  - `get_session cse_01X8sfFM64UdniNEnDZJMMtx` (2026-08-27 daily brief) — same
    shape. `cost_usd 0.858726`, `output_tokens 13824`. Ran 10:50→18:25.
  - The control: `trig_01FxDef9B5snYTW42FfcMEbD`, the only Routine with
    `created_via: http_api`, **does** carry `sources` and `outcomes` — plus seven
    `mcp_connections`. The four that deliver nothing are all `created_via:
meta_mcp`.
- **Error** None — the diagnosis completed.
- **Remediation** Not applied, and deliberately not attempted. `create_trigger`
  has no git-source parameter and `update_trigger` cannot add one, so the
  recommended fix is not merely unapproved but **outside the agent's tools**.
  Raised as A-10. Two prior hypotheses in T-27 are now dead and were struck
  rather than quietly dropped: it is not a permissions failure
  (`permission_mode: auto` on both sampled runs) and not a prompt failure (both
  runs produced a brief-sized body of work).

---

## OL-0013 — Consolidate onto the canonical repository

- **Timestamp** 2026-09-09T12:40:00Z
- **Task** T-28 · **Approval** A-11
- **Action** Moved the DD84 agent platform into
  `downdirty84llc-creator/georgia-opportunity-ledger`, ported and wired the three
  modules it lacked, wrote a CLAUDE.md for this repository, and repointed the
  four Routines.
- **Tool** `add_repo`, `git clone`, `git checkout -b`, `cp`, `Edit`, `npx tsc`,
  `npx next lint`, `npx vitest run`, `git commit`, `git push`,
  `update_trigger` ×4
- **Source** Owner decision, 2026-09-09: this repository is canonical.
- **Operator** Claude (agent)
- **Before** Two divergent copies. This repository ahead on the application
  (31 migrations, scanner wired, MFA reset built, Netlify schedules generated
  from the registry); `tune-advisor-` the only home of the agent platform and of
  four modules.
- **After** One repository holding both, on branch
  `claude/consolidate-agent-platform` at `00575a3`. `main` untouched, no pull
  request opened.
- **Evidence** — real output:
  - `npx tsc --noEmit` — no diagnostics.
  - `npx next lint` — `✔ No ESLint warnings or errors`.
  - `npx vitest run` — `Test Files 18 passed (18)`, `Tests 240 passed (240)`.
    That includes the 39 ported tests: `billing/mrr` (18),
    `analytics/sample-data` (13), `analytics/upgrade-source` (8).
  - `git push` — `* [new branch] claude/consolidate-agent-platform`.
- **Error** None.
- **Remediation** Two things were deliberately **not** done, and both would have
  looked like progress. `member-header.tsx` was not ported, because this
  repository's `header-session.tsx` already implements the same caching fix —
  copying it would have left two mechanisms for one job. And the older entries in
  this log, in `APPROVALS.md` and in `TASK-REGISTER.md` still name
  `tune-advisor-` branches; they were **not** rewritten to match present
  geography, because an append-only log edited to agree with the present is not a
  log. Only the live explainer, `docs/agents/README.md`, carries a superseded
  notice.

## OL-0014 — Repoint the Routines, and a negative result on T-27

- **Timestamp** 2026-09-15T12:45:00Z
- **Task** T-27, T-28 · **Approval** A-11 (consequence of the canonical-repo
  decision)
- **Action** Updated the four Routine prompts to name this repository, to push to
  a per-routine branch rather than `main`, and to **state plainly in the reply
  when they cannot commit** instead of finishing silently.
- **Tool** `update_trigger` ×4, `git ls-remote`
- **Source** T-28. Left alone, the Routines would have cloned a retired
  repository the moment T-27 was fixed.
- **Operator** Claude (agent)
- **Before** Four prompts naming `tune-advisor-` and the merged branch there.
- **After** Four prompts naming `georgia-opportunity-ledger`, branch `main`, each
  with its own push branch and an explicit instruction not to report success
  without a commit.
- **Evidence** — real output. Each `update_trigger` returned the stored prompt
  with the new text. Six days later, `git ls-remote --heads origin` on this
  repository lists `main`, `capability-probe`,
  `claude/georgia-opportunity-ledger-kfpt4c` and
  `claude/consolidate-agent-platform` — **and none of the four
  `claude/torque-*` branches the routines were told to push.**
- **Error** None from this change.
- **Remediation** **This is a negative result worth recording, not a gap in the
  work.** The prompt change was never expected to fix T-27; it was expected to
  make the failure legible and to stop the routines pointing at a dead
  repository. Six days of firing with corrected prompts and still no branch
  confirms what OL-0012 concluded: the fired sessions have no repository
  attached, so no wording will make them able to commit. **A-10 remains the
  only fix, and it remains with the owner.**

---

## Next entry: OL-0015

The next routine run or executed action appends here. If you are a routine: your
run entry goes at the bottom of this file and nothing above it is touched.
