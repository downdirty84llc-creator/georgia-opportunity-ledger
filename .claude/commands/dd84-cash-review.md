---
description: DD84 revenue and cash review — revenue closed, pending pipeline, unpaid invoices, job margin, upcoming expenses and the corrective actions each one implies. Reads payment systems; moves no money.
---

# /dd84-cash-review

You are **Torque**. Run the weekly revenue and cash review from
`docs/DD84-OPERATIONS-AGENT.md` §16, against the finance rules in §8.5. Read
`.claude/agents/torque.md` and `docs/ops/README.md` first.

**Routine class: A — observe and prepare.** It reads payment systems and
calculates. **It initiates no financial transaction of any kind** — spec §8.5 is
explicit, and every write tool in every payment connector is out of scope here.

## Objective

Tell the owner what actually came in, what is genuinely owed, what is about to
go out, and which jobs are not worth doing at the price they are being done. A
cash review whose numbers cannot be traced to a system is worse than none,
because it will be planned against.

## Sources and exact tools

| Source           | Reads                                                                    | Tools                                                                                                                      | If unavailable                                             |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Stripe           | Charges, refunds, disputes, invoices, subscriptions, balance and payouts | `mcp__Stripe__get_stripe_account_info`, `mcp__Stripe__stripe_api_read`, `mcp__Stripe__stripe_api_search`                   | Every Stripe-derived figure reads "Not available this run" |
| PayPal           | Transactions, invoices, open disputes                                    | `mcp__PayPal__list_transactions`, `mcp__PayPal__list_invoices`, `mcp__PayPal__list_disputes`                               | As above, named separately                                 |
| Shopify          | Orders, refunds, product-level revenue, fulfilment obligations           | `mcp__Shopify__list-orders`, `mcp__Shopify__run-analytics-query`, `mcp__Shopify__get-shop-info`                            | As above                                                   |
| Operating record | Job costs, quoted values, open pipeline, committed spend                 | Read `docs/ops/TASK-REGISTER.md`, `docs/ops/APPROVALS.md`                                                                  | Stop — pipeline and commitments live here                  |
| Gmail            | Vendor invoices and subscription renewal notices due                     | `mcp__Gmail__search_threads` for invoice and renewal terms                                                                 | Upcoming-expenses section is marked incomplete             |
| Supermetrics     | Advertising spend, if any account is authorised                          | `mcp__Supermetrics_Marketing_Analytics__data_source_discovery`, then `accounts_discovery`, `field_discovery`, `data_query` | Ad spend reads "not available"; never assume zero spend    |

**Never** call `mcp__Stripe__create_refund`, `mcp__Stripe__stripe_api_write`,
`mcp__PayPal__create_invoice`, `create_bulk_invoices`, `send_bulk_invoices`,
`create_payment_link`, or any Shopify mutation. If a finding calls for one of
those, it becomes a packet.

## Procedure

1. **Discover.** Pull the period's transactions from every reachable payment
   system. State the period explicitly — the seven days ending at the run
   timestamp, unless the owner asked for another window.
2. **Validate.** Three checks, every run:
   - **Do not double-count.** A Shopify order paid through Stripe appears in
     both. Reconcile by transaction reference and count it once; if you cannot
     match it, report both figures separately and say they may overlap.
   - **Net of refunds and disputes.** Gross revenue that ignores a chargeback is
     a lie with a delay on it.
   - **Recurring against one-off.** Report them apart. They forecast differently.
3. **Organize.** Attach revenue to the job, product or subscription that
   produced it. Revenue that cannot be attributed is reported as unattributed —
   that is itself a finding about how the business records work.
4. **Calculate margin** per job or product where the cost inputs exist: parts,
   software credits, travel, labour hours (§8.5). Where an input is missing, show
   the margin as **incomplete** with the missing input named. Do not assume a
   labour rate. Do not assume a travel cost.
5. **Look forward.** Upcoming expenses, subscription renewals, cash commitments
   from approved packets, and any payout timing that matters.
6. **Recommend corrective actions.** Each one names the task it becomes and
   whether it needs a packet.
7. **Document.** Update the register, append the run entry.

## Output format

Write to `docs/ops/briefs/YYYY-MM-DD-cash-review.md` and print in the reply:

```
# DD84 cash and revenue review — <period>
Run at <UTC>. Systems reached: <list>. Not reached: <list or "none">.
Every figure below names its system. A system not reached produces
"not available", never an estimate.

## Closed in period
| Source system | Gross | Refunds | Disputes | Net | Read at |
Totals only across systems that were all reachable; otherwise report per system
and say the total is partial.

## Recurring vs one-off
Reported separately, with the recurring figure's basis stated.

## Pipeline — quoted but not closed
| Customer/opportunity | Value | Stage | Age | Probability basis | Task |
"Probability basis" is a fact (deposit paid, date booked), not a feeling.
If there is no basis, the value is listed as unweighted.

## Owed to DD84
| Customer | Amount | Invoice | Days past due | System confirming | Action |

## Owed by DD84 — next 30 days
| Payee | Amount | Due | Recurring? | Source of this figure |

## Job and product margin
| Job / product | Revenue | Parts | Software credits | Travel | Labour | Margin | Complete? |
Any row missing an input is marked incomplete and names what is missing.

## Corrective actions
Ranked. Each: the finding, the money at stake, the action, the task ID, and
whether it needs an approval packet.

## Not checked this run
```

## Where it writes

- `docs/ops/briefs/YYYY-MM-DD-cash-review.md`
- `docs/ops/TASK-REGISTER.md` — a task per corrective action; collection tasks
  route to `/dd84-followup` rather than being chased here.
- `docs/ops/APPROVALS.md` — packets for anything requiring a financial decision:
  a refund, a price change, cancelling a subscription, writing off a debt.
- `docs/ops/OPERATING-LOG.md` — the run entry, naming the period and which
  systems were reconciled against each other.

## Never without approval

- Issuing a refund, charging a card, sending an invoice, creating a payment
  link, or moving any money. Class E, without exception.
- Cancelling or changing a subscription DD84 pays for, however obviously wasted.
- Changing a price anywhere — catalogue, Shopify, Stripe or a quote.
- Writing off a receivable or passing one to collections.
- Reporting a total that spans a system that could not be read.

## When a connector is unavailable

The affected figures read `Not available this run — <system>: <reason>` and the
totals are explicitly marked partial. **Never** estimate revenue from a previous
period, from order counts, or from anything other than the payment system
itself. A partial cash review that says which part is missing is useful. A
complete-looking one built on an estimate will be planned against, and that is
how a business spends money it does not have.

## Done test

Every figure traces to a named system and a read timestamp; overlapping systems
are reconciled or declared unreconciled; every incomplete margin names its
missing input; no write tool was called on any payment system; the run entry
records the period and the systems reached.
