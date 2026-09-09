# Opportunity Register — DD84 Tuning

**Agent:** Rev (Marketing & Revenue), operating under `docs/DD84-GROWTH-AGENT.md`
**Date:** 2026-08-03
**Venture:** DD84 Tuning (Down Dirty 84 LLC)
**Stage:** Discovery and validation complete. Awaiting owner decision.

> **Why this file is in this repository.** It concerns a different venture from
> the Georgia Opportunity Ledger. DD84 Tuning has no repository of its own, and
> `docs/DD84-GROWTH-AGENT.md` is already the cross-venture record, so the growth
> documents live together. Nothing here changes any Ledger code.

> **Customer names are deliberately omitted.** §23 forbids publishing
> confidential customer information, and this file is version-controlled.
> Customers are referred to as A, B and C; the names are in Stripe.

**No external action has been taken.** No campaign was published, no message
sent, no price changed, no Shopify or Stripe object created or modified.

---

## Verified facts

Every figure below was read from the live Shopify Admin API or the live Stripe
account. Nothing is estimated.

| #   | Fact                                                                                                                                                                                                                                                              | Evidence                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| T1  | **All-time revenue is $3,507.86** across **10 paid invoices** from **3 customers**. Average $350.79                                                                                                                                                               | Stripe `GetCharges`, all `livemode: true`  |
| T2  | Revenue is concentrated: A = $2,350.79 (67%, 6 invoices), B = $1,118.37 (32%, 3), C = $38.70 (1%, 1)                                                                                                                                                              | as above                                   |
| T3  | **The last payment was 2025-09-12 — roughly eleven months ago.** Nothing has been collected since                                                                                                                                                                 | as above                                   |
| T4  | Every charge came through **bookipay** invoicing (`metadata.application`), not a storefront                                                                                                                                                                       | charge metadata                            |
| T5  | ~~Paid invoice numbers are 5–10, 13, 14, 17, 18; eight are missing~~ — **closed by owner decision 2026-08-07.** Accurate as recorded, but no longer a line of enquiry                                                                                             | derived from charge descriptions           |
| T6  | The Shopify store has **0 orders and $0** in the last 365 days                                                                                                                                                                                                    | ShopifyQL `FROM sales`                     |
| T7  | Store traffic: **397 sessions in Jan 2026**, then 34/29/26/38/29/19/2 — about one visitor a day                                                                                                                                                                   | ShopifyQL `FROM sessions TIMESERIES month` |
| T8  | Last 180 days by source: direct 146, social 16, **search 7**, unknown 3, email 1                                                                                                                                                                                  | ShopifyQL `GROUP BY referrer_source`       |
| T9  | 574 sessions → 23 carts → 20 reached checkout → **0 completed**                                                                                                                                                                                                   | ShopifyQL `FROM sessions`                  |
| T10 | Checkout is **not** obviously broken: inventory untracked and `availableForSale: true`, Shopify/Apple/Google Pay active, `setupRequired: false`, `loginRequiredAtCheckout: false`, and every print-on-demand delivery profile has a United States zone with rates | Shopify Admin GraphQL                      |
| T11 | **Zero abandoned checkouts** are recorded despite 20 sessions reaching checkout                                                                                                                                                                                   | `abandonedCheckouts` query                 |
| T12 | The catalog is substantial: 25+ products from $19.99 to $650 — Holley EFI calibrations, ECU file reviews, PCM unlock and removal, wiring and EFI diagnostics, shop licences, consulting sessions, print-on-demand merch                                           | Shopify `search_products`                  |
| T13 | The store domain is `shop.downdirty84llc.com`. **dd84tuning.com is a separate property** and returns HTTP 403 to automated fetches, so its content could not be inspected                                                                                         | `get-shop-info`; direct fetch              |

---

## The finding that governs everything else

**This business had a working revenue model, stopped using it, and replaced it
with one that has never produced a sale.**

The sequence is unambiguous:

- **Feb–Sep 2025** — $3,507.86 collected through **invoiced service work**.
  Relationship-based, high-ticket (average $350.79, largest $1,287.50), and
  genuinely repeat: customer A paid six separate invoices over five months.
- **Sep 2025** — invoicing stops. No revenue since.
- **Jan 2026** — a large self-serve Shopify catalogue launches, four months
  _after_ the money stopped.
- **Jan 2026 – today** — 574 sessions, 20 checkout attempts, **$0**.

The catalogue is not the problem in the way it first appears. The problem is
that the motion which demonstrably made money — invoice a named customer for
work — was abandoned, and the motion that replaced it has no audience pointed
at it. Seven search visits in six months is not a conversion problem. It is
invisibility.

### A correction to my own earlier diagnosis

I first reported the 0-of-20 checkout record as a near-certain fault, calling it
"roughly a one-in-a-million result". **That was bad statistics and I withdraw
it.** It assumed twenty independent buyers with genuine intent. Spread across
twelve months that is 1.7 checkout-reaches per month, most of them inside the
January launch spike when the store was being built and very likely tested by
the owner. At that volume zero completions is unremarkable. Four mechanical
causes were then checked and all four are configured correctly (T10).

Checkout is **not cleared** — it is merely **not indicted**. One real test
purchase settles it, and that is listed below as hygiene rather than as an
opportunity.

---

## Scored opportunity queue

Scored on the §9 ten-factor method, components shown.

Rev /20 · Prof /15 · Spd /10 · Fit /10 · Auto /10 · Urg /10 · Rpt /10 · Adv /5 ·
Time /5 (higher = less owner involvement) · Risk −15…+5.

| ID       | Opportunity                                                                                      | Rev | Prof | Spd | Fit | Auto | Urg | Rpt | Adv | Time | Risk | **Total** |
| -------- | ------------------------------------------------------------------------------------------------ | --: | ---: | --: | --: | ---: | --: | --: | --: | ---: | ---: | --------: |
| T-02     | Resume the invoiced service motion as the primary model                                          |  16 |   13 |   8 |  10 |    4 |   6 |   9 |   4 |    2 |   −2 |    **70** |
| T-01     | Reactivate the three customers who already paid                                                  |  14 |   14 |  10 |  10 |    3 |   6 |   8 |   4 |    2 |   −1 |    **70** |
| T-04     | Make the catalogue findable at all                                                               |  13 |   13 |   2 |   9 |    8 |   3 |  10 |   3 |    4 |   −2 |    **63** |
| T-06     | Ask the repeat customers for referrals                                                           |  10 |   13 |   7 |   9 |    3 |   4 |   7 |   4 |    2 |   −1 |    **58** |
| T-05     | Consolidate the three web surfaces                                                               |   9 |   11 |   4 |   9 |    7 |   5 |   7 |   3 |    4 |   −2 |    **57** |
| ~~T-07~~ | ~~Audit what those ten invoices were actually for~~ — **withdrawn 2026-08-07 by owner decision** |   — |    — |   — |   — |    — |   — |   — |   — |    — |    — |     **—** |

**Priority rule.** T-01 leads despite tying on score, because §9 puts urgent
revenue recovery ahead of everything. It is also the only item that could
produce cash this week. ~~T-07 blocks T-02 and runs first in practice.~~
**T-07 was withdrawn on 2026-08-07 by owner decision**, so T-01 and T-02 proceed
without it — see the note under T-07 for what that costs.

### Hygiene, not an opportunity

**One test purchase.** Buy something from the store on a real card, then refund
it. It costs a few dollars in fees and definitively separates "checkout is fine,
nobody visits" from "checkout is broken." Not scored, because clearing a doubt
is not a revenue opportunity — but do it before spending anything on traffic.

---

## Approval briefs

### T-01 — Reactivate the three customers who already paid · 70 · urgent revenue

| Field                       | Content                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opportunity**             | Three people have paid this business real money — one of them six times, totalling $2,350.79. **None has been invoiced in eleven months.** They are the warmest possible audience and they cost nothing to reach.                                                               |
| **Business fit**            | DD84 Tuning service work: the exact thing they already bought.                                                                                                                                                                                                                  |
| **Target customer**         | Customer A (6 invoices, $2,350.79), customer B (3, $1,118.37), customer C (1, $38.70). Names in Stripe.                                                                                                                                                                         |
| **Offer**                   | Not a discount. A specific, relevant next service. With T-07 withdrawn, the owner supplies which service to lead with from their own memory of the work — Rev must not guess it.                                                                                                |
| **Execution**               | Personal outreach from the owner, not a campaign. One message each, referencing their actual vehicle or prior job, proposing the logical next piece of work, with an invoice ready to send.                                                                                     |
| **Channels**                | Direct: the contact method already on file in bookipay or Stripe. No advertising.                                                                                                                                                                                               |
| **Cost and budget ceiling** | **$0.**                                                                                                                                                                                                                                                                         |
| **Revenue potential**       | If one of the two repeat customers returns at the historic average, $350.79. If customer A resumes their prior cadence, materially more. **Stated as a range anchored on their own history — not a forecast**, and three customers is far too small a base to extrapolate from. |
| **Risks and safeguards**    | Eleven months of silence makes a sudden sales message read badly; lead with the work, not the ask. Do not imply an ongoing relationship that lapsed. No guarantees about results — §23.                                                                                         |
| **Success metrics**         | Replies, quotes issued, invoices paid, and whether either repeat customer returns.                                                                                                                                                                                              |
| **Approval choices**        | Approve as planned · approve with changes · hold · reject                                                                                                                                                                                                                       |
| **After approval**          | Rev drafts the three messages for the owner to review and send. **Rev will not send them** — these are personal relationships and the owner's own voice is the asset.                                                                                                           |

### ~~T-07 — Audit what the ten invoices were actually for~~ · withdrawn

**Withdrawn 2026-08-07 by owner decision.** The invoices are closed as a line of
enquiry and are not to be reopened.

The brief argued that we know exactly how much was earned and by whom, but not
**what was sold**, and that this made every "lead with this service"
recommendation guesswork. That reasoning still stands — it is simply no longer
being pursued.

**What that costs, stated plainly so nobody is surprised later:** the ranked
list of what has genuinely sold does not exist and will not be produced. T-01
and T-02 therefore rely on the owner naming which services to lead with from
memory. **Rev must not substitute a guess** — the registry's `UNKNOWN` on this
still binds, and an invented answer here would be a fabrication, not an
estimate.

### T-02 — Resume the invoiced service motion · 70

| Field                       | Content                                                                                                                                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Opportunity**             | 100% of revenue this business has ever earned came from invoiced service work. 0% came from the self-serve catalogue, across 574 sessions. The evidence for which model works is one-sided.        |
| **Business fit**            | The core tuning and diagnostic services.                                                                                                                                                           |
| **Target customer**         | The same profile that already paid: owners and shops wanting hands-on calibration and diagnostic work, who expect a quote and an invoice rather than an add-to-cart.                               |
| **Offer**                   | Named services at the prices already proven ($175–$1,287 observed), quoted per job.                                                                                                                |
| **Execution**               | Re-establish intake → quote → invoice as the primary path, with the catalogue supporting it rather than replacing it. Which services to lead with comes from the owner, not from an invoice audit. |
| **Channels**                | Direct, referral, and whatever channel produced the original three customers — **currently unknown**, which is itself worth establishing.                                                          |
| **Cost and budget ceiling** | **$0** for the motion itself. Any paid acquisition is a separate brief.                                                                                                                            |
| **Revenue potential**       | Historic monthly run rate Feb–Sep 2025 was roughly $438/month across three customers. **That is history, not a projection**, and it came from a customer base too small to extrapolate.            |
| **Risks and safeguards**    | Invoiced work does not scale without owner time, which is exactly why the catalogue was built; this brief argues for sequencing, not for abandoning the catalogue. Do not guarantee outcomes.      |
| **Success metrics**         | Quotes issued per month, quote-to-invoice rate, collected revenue, repeat rate.                                                                                                                    |
| **Approval choices**        | Approve as planned · approve with changes · hold · reject                                                                                                                                          |
| **After approval**          | Rev builds the intake-to-invoice path and the follow-up rules, once the owner names the services to lead with.                                                                                     |

### Remaining queue — summaries

- **T-04 · Make the catalogue findable (63).** Seven search visits in 180 days.
  The catalogue is well written and completely invisible. This is the long-term
  fix and contributes nothing this quarter, which is why it sits behind the
  reactivation work.
- **T-06 · Referrals from the repeat customers (58).** Customer A bought six
  times. People who buy six times know other people with the same problem. Ask
  only after T-01 has re-established contact.
- **T-05 · Consolidate the three surfaces (57).** dd84tuning.com, the Shopify
  store and the Stripe/bookipay invoicing are three disconnected places.
  Traffic landing on one cannot buy on another, and revenue is tracked in two
  systems that do not talk.

---

## Open questions Rev could not answer

1. **Where did the three customers come from?** No attribution exists for
   invoiced work.
2. **What is on dd84tuning.com?** It returns 403 to automated fetches.

**Closed by owner decision 2026-08-07, do not reopen:** what the ten invoices
were for, and whether the gaps in invoice numbering represent unpaid invoices.

## What Rev is asking for

Run **T-01** first — it is the only item that can produce revenue this week, and
with T-07 withdrawn there is nothing left blocking it. Then decide between
**T-02** and **T-04** depending on whether the goal is cash now or compounding
traffic later.

And do the test purchase before spending a dollar on traffic.

---

## Completion record — T-04, catalogue SEO · 2026-08-03

Approved and executed against the live Shopify store. **Metadata only** — no
product handle, visible title, price, description or publication status was
changed, so no existing URL breaks and nothing customers see moved.

### What was changed

**Five tuning-service products** had no SEO title at all. These are the ones
that matter, because they are the same invoiced service work that produced
100% of this venture's revenue:

| Product                                    | New SEO title                                      |
| ------------------------------------------ | -------------------------------------------------- |
| Holley EFI Tuning & Diagnostics Service    | Holley EFI Tuning & Diagnostics Service \| DD84    |
| Toyota / Lexus Performance Tuning Service  | Toyota & Lexus Performance ECU Tuning \| DD84      |
| Dodge / Mopar Custom ECU Tuning Service    | Dodge & Mopar Custom ECU Tuning Service \| DD84    |
| Dodge / Mopar PCM Unlock Service           | Dodge & Mopar PCM Unlock Service \| DD84           |
| Performance Wiring & EFI Power Diagnostics | Performance Wiring & EFI Power Diagnostics \| DD84 |

Each also received a meta description under 160 characters.

**Three collections** had no SEO. Collection pages usually rank for category
terms, so these were the highest-leverage gap in the catalogue:

- Holley EFI Custom Calibration Services (6 products)
- Digital Downloads (27) → "Digital Tuning Downloads, Guides & Calibrations"
- DD84 Performance Merch (17) → "Automotive Performance Apparel & Garage Merch"

**Ten merch products** had descriptions but no SEO title. Filled in.

Result: **48 of 50 active products** and **4 of 6 collections** now carry an
SEO title, up from 31 and 1.

### The pattern used, and why

Existing good entries already followed "search term first, brand last"
(`Holley EFI LS Naturally Aspirated Startup File | DD84`). That house style was
matched exactly rather than replaced.

It matters more than it looks. Twenty-nine of the fifty product titles begin
with "DD84" or "Down Dirty 84", which puts the highest-weight position in the
title tag on a brand that drew **seven search visits in 180 days**. Leading with
the term a stranger would actually type — "Holley EFI tuning", "Dodge PCM
unlock" — and keeping the brand as the suffix costs nothing and stops wasting
that position. The visible product titles were left alone; only the `<title>`
tag changed.

### Deliberately not done

- **The duplicate pair.** "DD84 Tune Support Advisor Access" exists **twice**,
  both active, both $99, both with no SEO. Giving two identical pages SEO titles
  would create competing duplicate pages, which is worse than leaving them
  blank. One should be archived or merged — that is a destructive change and
  needs an owner decision.
- **"General Clothes example products"** — an empty leftover from the theme
  demo, still live with 0 products. Should be deleted; not Rev's call.
- **"Home page"** — the theme's default collection, left alone.
- **Handles and visible titles** — unchanged on purpose. Changing a handle
  404s every existing link to that product.

### Honest expectation

This will not produce revenue quickly, and it is not a substitute for the
briefs above. Search takes weeks to months to reflect metadata changes, the
baseline is seven visits per 180 days, and metadata alone does not create
authority for competitive terms like "Holley EFI tuning".

What it does is remove a self-inflicted handicap and make the catalogue
eligible to be found. **T-01 — reactivating the three customers who already
paid — remains the only item in this register that could produce cash this
week.**
