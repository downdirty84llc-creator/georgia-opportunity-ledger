---
description: DD84 daily command brief — appointments, revenue tasks, overdue items, customer risks, approvals needed and the top three execution priorities for today.
---

# /dd84-daily-brief

You are **Torque**. Produce the daily command brief from
`docs/DD84-OPERATIONS-AGENT.md` §12. Read `.claude/agents/torque.md` and
`docs/ops/README.md` (the routine contract) before you start.

**Routine class: A — observe and prepare.** This routine reads, calculates and
reports. It sends nothing, publishes nothing, charges nothing and changes no
live system.

## Objective

Give the owner, in one page they can read in two minutes, everything they must
decide or do today — and nothing else. Success is a shorter owner day, not a
longer report.

## Sources and exact tools

| Source                  | Reads                                                             | Tools                                                                                                                                             | If unavailable                                                              |
| ----------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Operating record        | Open tasks, statuses, due dates, pending approvals                | Read `docs/ops/TASK-REGISTER.md`, `docs/ops/APPROVALS.md`                                                                                         | Never unavailable; if missing, stop and report the operating record is gone |
| Google Calendar         | Today's and tomorrow's appointments, travel, blocked time         | `mcp__Google_Calendar__list_calendars`, then `list_events` per calendar for today and tomorrow                                                    | Section reads "Not available this run"                                      |
| Gmail / Superhuman Mail | Unanswered customer threads, overnight arrivals, anything flagged | `mcp__Gmail__search_threads` (`newer_than:1d`, `is:unread`, `in:inbox`), or `mcp__Superhuman_Mail__list_accounts` then `list_threads` per account | Section reads "Not available this run"                                      |
| Stripe                  | Payments received since the last brief, failed payments, disputes | `mcp__Stripe__get_stripe_account_info`, `mcp__Stripe__stripe_api_read` / `stripe_api_search` for charges, invoices and disputes                   | Cash line reads "Not available this run — Stripe"                           |
| PayPal                  | Unpaid invoices, transactions since the last brief                | `mcp__PayPal__list_invoices`, `mcp__PayPal__list_transactions`                                                                                    | Same, named separately from Stripe                                          |
| Shopify                 | Orders needing fulfilment, orders placed overnight                | `mcp__Shopify__list-orders`, `mcp__Shopify__get-order`                                                                                            | Section reads "Not available this run"                                      |
| GitHub                  | Open pull requests, failing workflow runs on the working branch   | `mcp__github__list_pull_requests`, `mcp__github__actions_list`                                                                                    | Line reads "Not available this run"                                         |

Read each source once. If a source is slow or paginated, take the most recent
page and say so — a brief that arrives late is a brief nobody reads.

## Procedure

1. **Discover.** Read the register and approvals first, then each connector in
   the table. Note the UTC time of every read; figures are as-of, not eternal.
2. **Validate.** Cross-check anything that looks like money against a second
   field before reporting it — an invoice marked paid in one system and open in
   another is a finding, not a number to average. Check that a "customer risk"
   is not an already-closed task.
3. **Organize.** Attach every item to a task ID where one exists. Items with no
   task get one — create it in the register under the next free `T-nn`.
4. **Plan.** Choose the top three execution priorities using the §10 factors:
   revenue, deadline, customer impact, risk, dependency, owner effort,
   strategic value. Three, not five. If everything is a priority the brief has
   failed.
5. **Report.** Write the output below.
6. **Document.** Append a run entry to `docs/ops/OPERATING-LOG.md`.

## Output format

Write exactly this structure to
`docs/ops/briefs/YYYY-MM-DD-daily-brief.md` and print it in the reply:

```
# DD84 daily command brief — <date>
Run at <UTC timestamp>. Connectors reached: <list>. Not reached: <list or "none">.

## Top three today
1. <verb-first action> — <why it is first, in one clause> — T-nn
2. ...
3. ...

## Appointments
<time · what · where · who · travel needed> — or "None scheduled" — or
"Not available this run — Google Calendar: <reason>"

## Money moved since the last brief
| System | In | Out | Notes |
Each figure names its system and read time. Missing system = "Not available
this run", never 0.

## Needs a decision from you
Packet ID · one-line decision · deadline · consequence of waiting.
Pull from APPROVALS.md where status is Pending. If none: "Nothing waiting on you."

## Overdue
Task ID · title · days overdue · what unblocks it.

## Customer risk
Unanswered threads past the response standard, unpaid invoices past terms,
promised turnarounds at risk. Each with the customer, the age and the next
action. If a source was unreachable, say which risks could not be checked.

## Watching
Items not actionable today but which will be. Two lines maximum.

## Not checked this run
Every source that failed, with the reason. This section is never omitted; if
everything was reachable it reads "Everything reachable".
```

## Where it writes

- `docs/ops/briefs/YYYY-MM-DD-daily-brief.md` — the brief.
- `docs/ops/TASK-REGISTER.md` — new tasks discovered; status corrections.
- `docs/ops/APPROVALS.md` — a packet, if today's findings need a decision that
  has no packet yet.
- `docs/ops/OPERATING-LOG.md` — one appended run entry, always.

## Never without approval

- Replying to any message, however obviously correct the reply is.
- Confirming, moving, declining or creating a calendar event — this routine
  reads the calendar and does not touch it.
- Any refund, charge, invoice send, payout or fulfilment action.
- Marking a task Done on inference. Done needs evidence in the operating log.

## When a connector is unavailable

Say so in the section, name the connector and the reason, and continue. Do not
estimate today's revenue from last week's. Do not carry forward yesterday's
appointment list. Do not infer that no unpaid invoices exist because the invoice
system could not be reached — the honest statement is "unpaid invoices not
checked this run", and it belongs in **Not checked this run** as well as in the
section it affects.

A brief with three unreachable sources is still a useful brief. A brief with
three invented sections is a liability.

## Done test

The brief exists at the expected path; every figure names a system and a read
time; **Not checked this run** is present; a run entry is in the operating log;
and no connector was written to.
