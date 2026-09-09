# DD84 operating record

This directory is the operating record for **Torque**, the DD84 operations
execution agent defined in `.claude/agents/torque.md` and specified in
`docs/DD84-OPERATIONS-AGENT.md`.

It exists because of one failure mode the specification names directly: agent
output that stays in a conversation is not operational. Section 3 requires agent
findings to be converted into "traceable tasks rather than isolated
conversations", and section 9 requires "one authoritative operating record even
when information originates in multiple systems". A chat transcript is neither.
These files are.

---

## The three files

| File               | Spec section       | Answers                                                             | Write mode                                      |
| ------------------ | ------------------ | ------------------------------------------------------------------- | ----------------------------------------------- |
| `TASK-REGISTER.md` | §4 task standard   | What work exists, who owns it, what it is waiting on, what it costs | Live document — statuses are edited in place    |
| `APPROVALS.md`     | §9 approval record | What the owner was asked, what they answered, and what limits apply | Append a packet; edit only the response block   |
| `OPERATING-LOG.md` | §9 execution log   | What was actually done, by which tool, with what evidence           | **Append-only** — never edit or delete an entry |

They are deliberately three files rather than one. A task changes status many
times; an approval is answered once and then becomes history; an execution
record must never change at all. Mixing those write modes in one file is how
audit trails get quietly rewritten.

### How they link

```
TASK-REGISTER  T-06 ──approval class E──►  APPROVALS  A-03  ──authorises──┐
      ▲                                                                   │
      └────────────evidence: OL-0003, OL-0004 ◄──── OPERATING-LOG ◄───────┘
```

- Every task with an approval class above **A** names the approval ID that
  authorised it, or reads `awaiting A-nn`.
- Every approval names the task IDs it covers and the actual result once
  executed.
- Every log entry names the task ID it advanced and the evidence — a commit
  hash, a confirmation number, a URL, a test output.

A task may not move to **Done** unless there is a log entry with evidence. If
the evidence cannot be obtained, the status is **In Verification**, never Done.
That is spec §14, and it is the rule these files exist to make enforceable.

---

## Statuses

Task statuses, in the order a task normally travels:

| Status                | Means                                                                               |
| --------------------- | ----------------------------------------------------------------------------------- |
| **Backlog**           | Captured and real, not yet scheduled.                                               |
| **Planned**           | Scoped with steps, tools and a success test; ready to start.                        |
| **Awaiting Approval** | Packet submitted; execution is blocked until the owner answers.                     |
| **Blocked**           | Blocked by a dependency that is not an approval — access, a payment, a third party. |
| **In Progress**       | Being executed now.                                                                 |
| **In Verification**   | Executed, but the result has not been confirmed in the destination system.          |
| **Done**              | Verified in the destination system, with evidence recorded in the operating log.    |
| **No Action**         | Deliberately not doing it, with the reason recorded. Not deleted.                   |

Approval statuses: **Pending**, **Approved**, **Approved with changes**,
**Deferred**, **Rejected**, **Expired**.

---

## The routine contract

Every routine in `.claude/commands/dd84-*.md` obeys the same contract. The
individual command files restate the parts specific to them; this is the shared
core, and it is what makes the routines safe to run unattended.

1. **Class A only.** Every routine observes, calculates, drafts and reports. No
   routine sends, publishes, charges, refunds, deploys, deletes or changes a
   live system. Anything a routine finds that requires such an action becomes an
   approval packet in `APPROVALS.md`, not an action.
2. **A missing connector degrades a section; it never invents one.** If a
   connector is absent from the session, errors, or returns nothing, the routine
   writes `Not available this run — <connector>: <reason>` in that section and
   continues. It does not estimate, does not carry forward a previous run's
   number as if it were current, and does not infer a figure from another source
   without labelling it an inference.
3. **Numbers carry their source.** Every figure in a routine output names the
   system it came from and the timestamp of the read. A number without a source
   is a defect.
4. **Every run writes.** A routine that produces no output file still appends a
   run entry to `OPERATING-LOG.md`, including a run that found nothing. "Nothing
   to report" is a finding; silence is a gap.
5. **Every run reconciles.** Before reporting, a routine reads the current
   `TASK-REGISTER.md` so that it neither duplicates an existing task nor reports
   an item already closed.
6. **Uncertainty is stated, not smoothed.** Where a routine is unsure whether an
   item is a duplicate, whether a payment cleared, or whether a page is genuinely
   broken, it says so and proposes the check that would resolve it.

### Where routine output goes

| Output                      | Destination                                 |
| --------------------------- | ------------------------------------------- |
| The report itself           | `docs/ops/briefs/YYYY-MM-DD-<routine>.md`   |
| New or changed tasks        | `TASK-REGISTER.md`                          |
| Anything needing a decision | `APPROVALS.md` as a packet in the §7 format |
| The record of the run       | `OPERATING-LOG.md`, appended                |

Routine reports in `briefs/` are outputs, not sources. When a brief and the
register disagree, the register is controlling — spec §3 source hierarchy.

---

## Scheduling

Routines are invoked as slash commands (`/dd84-daily-brief`) or fired by a
scheduled trigger the **owner** configures. Torque does not create its own
schedules; an agent that can schedule its own recurring execution has escaped
the approval boundary in a way the spec does not contemplate.

Suggested cadence, from spec §16 — the owner sets the actual schedule:

| Routine                  | Cadence                 | Spec §16 routine                  |
| ------------------------ | ----------------------- | --------------------------------- |
| `/dd84-daily-brief`      | Each business morning   | Daily command brief               |
| `/dd84-inbox-intake`     | Twice each business day | Daily inbox and lead intake       |
| `/dd84-followup`         | Each business day       | Customer follow-up engine         |
| `/dd84-site-monitor`     | Daily                   | Website and checkout monitor      |
| `/dd84-cash-review`      | Weekly                  | Weekly revenue and cash review    |
| `/dd84-opportunity-scan` | Weekly                  | Weekly Georgia Opportunity Ledger |

Spec §16 lists two further routines — the weekly marketing opportunity scan and
project status control — that are **not yet built as commands**. They are
tracked as T-24 and T-25 in the register rather than left implied.
