---
name: rev-daily-brief
description: >-
  Produce Rev's daily operating brief across Down Dirty 84 ventures — new
  opportunities, approvals waiting, hot leads, problems, and the single next
  highest-value action. Use when asked for the daily brief, a growth status
  update, "what should I work on", or when a scheduled Routine fires the daily
  brief. Read-only: it never publishes, spends, messages a customer, or changes
  a price.
---

# Rev — Daily Operating Brief

§26 of `docs/DD84-GROWTH-AGENT.md`: _"New opportunities, approvals waiting,
approved work completed, hot leads, problems and the next highest-value
action."_

## This skill is read-only. That is the point.

It runs unattended, so it must never take an action that cannot be undone by
closing a tab.

**Permitted:** reading APIs, reading the repository, writing a brief file under
`docs/growth/briefs/`, committing and pushing that file.

**Forbidden, without exception:** publishing anything, sending any message,
spending anything, creating or changing a Stripe object, changing a price,
altering a live storefront, or modifying application code.

If the brief surfaces something urgent, **say so loudly in the brief and stop.**
Escalation is the output; acting on it is not.

## Steps

### 1. Load context

Read `docs/agents/ventures.md`, then the newest files in `docs/growth/`. Note
which registry figures are older than 30 days — those get re-verified below and
the registry updated if they moved.

### 2. Pull live numbers

**DD84 Tuning** — via Shopify and Stripe:

```
FROM sales SHOW orders, gross_sales, total_sales SINCE -30d UNTIL today
FROM sessions SHOW sessions, sessions_that_reached_checkout, sessions_that_completed_checkout SINCE -30d UNTIL today
FROM sales SHOW orders, total_sales GROUP BY product_title ORDER BY total_sales DESC LIMIT 5 SINCE -30d UNTIL today
```

Plus recent Stripe charges, and any new Shopify orders or customers.

**Georgia Opportunity Ledger** — only if it has been deployed. Until then, state
its blocker in one line and move on. Do not pad the brief with a system that
cannot transact.

### 3. Compare against the last brief

The change is the story. A number on its own is noise; a number that moved is a
signal. Call out anything that moved materially and say what you think caused it.

**A first sale, a first search visitor, or a returning customer outranks
everything else in the brief.**

### 4. Write the brief

To `docs/growth/briefs/YYYY-MM-DD-daily-brief.md`, in this order:

1. **Headline** — one sentence. If nothing changed, say exactly that. A brief
   that manufactures significance is worse than a brief that says "no movement,
   here is the one thing worth doing."
2. **Money** — revenue in the period, orders, and days since the last payment.
3. **What moved** — versus the previous brief, with the cause where known.
4. **Approvals waiting** — every open brief from `docs/growth/`, with its score
   and what it is blocked on.
5. **Hot leads** — any new customer, order or enquiry. Each needs a next action
   and a date, or it breaks the zero-lead-loss rule.
6. **Problems** — anything broken, stalled, or drifting.
7. **The next highest-value action** — exactly one, with the reason. Not a list.

### 5. Keep it honest

- Cite the source of every figure.
- Mark estimates as estimates.
- If a previous brief was wrong, correct it here, visibly.
- **If there is genuinely nothing new, the brief is three lines long.** Never
  inflate. The owner learns to ignore a brief that cries wolf, and then the
  brief is worthless on the day it matters.

### 6. Commit

Commit and push the brief file only. If a registry figure changed, update
`docs/agents/ventures.md` with the new value and its verification date in the
same commit.
