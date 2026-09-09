# Venture Registry

The business context Rev operates against. §30 of `docs/DD84-GROWTH-AGENT.md`
requires "a business and venture registry containing brands, offers, pricing,
service areas, capabilities and restrictions" — this is that file.

**Read this before doing anything.** It exists so Rev does not re-derive the
same facts on every run, and so a claim about the business can be checked
against a written source instead of being invented.

**Every figure here was read from a live system on the date shown.** When a
figure is older than 30 days, re-verify it rather than quoting it. Facts that
could not be verified are marked `UNKNOWN` and must stay that way until someone
checks — an `UNKNOWN` is not an invitation to estimate.

**No customer names, emails or payment details in this file.** It is
version-controlled. §23 forbids publishing confidential customer information.
Customer detail lives in Stripe and bookipay.

---

## Owner and authority

| Field              | Value                                                           |
| ------------------ | --------------------------------------------------------------- |
| Owner              | Down Dirty 84 LLC (`downdirty84llc@gmail.com`)                  |
| Approval mechanism | The owner, in conversation. No standing budget authority exists |
| Spend authority    | **$0.** Every paid commitment needs explicit per-item approval  |
| Pricing authority  | **None.** Rev may propose prices, never change them             |
| Discount policy    | No standing policy. Every discount needs approval               |
| Refund authority   | **None.** Refunds are the owner's                               |

---

## Venture 1 — DD84 Tuning

Automotive performance: ECU and EFI calibration, diagnostics, PCM services,
digital tuning tools, and merchandise.

### Systems

| System          | Identifier                                                                                           | Verified              |
| --------------- | ---------------------------------------------------------------------------------------------------- | --------------------- |
| **Front door**  | **`dd84tuning.com`, built and hosted on Manus. Everything runs through it** — see below              | 2026-08-13 _(stated)_ |
| Shopify store   | `shop.downdirty84llc.com` (`49qz1e-0r.myshopify.com`), Basic plan, USD, EDT                          | 2026-08-03            |
| Stripe          | `acct_1QBl8ZINLKqe1c6g` — "Down Dirty 84 llc"                                                        | 2026-08-03            |
| Invoicing       | **bookipay** — every historic payment came through it. Rev has **no API access** to it               | 2026-08-03            |
| Print-on-demand | Printify, District Photo, Sensaria, Printed Mint, MWW, Duplium, Lumient, Fulfill Engine, Deco Slides | 2026-08-03            |

### The front door — and why every traffic figure below is suspect

**Owner statement, 2026-08-13: `dd84tuning.com` is a Manus site, and everything
runs through it — the tuning business, the Ledger, and traffic into the Shopify
store.** Shopify is a checkout behind it, not the shop window.

**This is `stated`, not `verified`, and cannot currently be verified by Rev.**
`dd84tuning.com` is blocked by this environment's network egress proxy, and there
is no Manus connector on this account. Rev can read neither the site nor its
analytics. Until that changes, **anything about the front door is the owner's
word, recorded as such** — which is a legitimate source, and is still not the
same as a reading.

**What this invalidates.** Every traffic and channel figure in this file was read
from Shopify. If Shopify is the second step, those numbers describe the back half
of the funnel and say nothing about the front. They remain true of Shopify and
must stop being quoted as if they described the business.

> **Correction — the 2026-08-03 diagnosis was measured on the wrong surface.**
> Rev concluded that DD84 Tuning's problem was **invisibility**, and rested it on
> Shopify's 7 organic search visits in 180 days. That figure is real, but it
> measures a page that may never have been the landing surface. **If the audience
> arrives at `dd84tuning.com`, the business is not invisible — Rev was looking at
> the wrong window.** The finding that survives untouched is the money: 0 Shopify
> orders all time, and no payment collected since 2025-09-12. Those come from
> Stripe and Shopify order records, not from traffic attribution.

**The most valuable unknown in this file is now the Manus site's analytics.**
Sessions, sources and conversions for `dd84tuning.com` would settle in one
reading what the Shopify numbers cannot: whether anyone is arriving at all, and
what they do next. Ask for it before commissioning any further marketing work.

### Revenue — the single most important fact in this file

| Metric                   | Value                                                | Verified   |
| ------------------------ | ---------------------------------------------------- | ---------- |
| All-time revenue         | **$3,507.86**                                        | 2026-08-03 |
| Paid invoices            | 10                                                   | 2026-08-03 |
| Distinct customers       | **3**                                                | 2026-08-03 |
| Average invoice          | $350.79                                              | 2026-08-03 |
| Largest invoice          | $1,287.50                                            | 2026-08-03 |
| Concentration            | One customer = 67% (6 invoices); two customers = 99% | 2026-08-03 |
| **Last payment**         | **2025-09-12** — nothing collected since             | 2026-08-03 |
| Shopify orders, all time | **0**                                                | 2026-08-03 |

**100% of revenue came from invoiced service work. 0% from the storefront.**
Any plan that assumes self-serve digital products are the revenue model is
arguing against the only evidence that exists.

**What those invoices were actually for is `UNKNOWN`** — Stripe records amounts
and invoice numbers, not line items.

**Owner decision, 2026-08-07: the invoices are closed as a line of enquiry.**
Do not chase the line items, and do not raise the gaps in invoice numbering.
The `UNKNOWN` above still binds — Rev must not guess which service earned the
money, and must not present a guess as the reason a service is worth leading
with. It is simply not a question to keep asking.

### Traffic

**Shopify only. This is the back half of the funnel** — see "The front door"
above. `dd84tuning.com`'s own traffic is unread and is the figure that matters.

| Metric                       | Value                                                                                                                                          | Verified   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Sessions, trailing 12 months | 574 (397 of them in the Jan 2026 launch month)                                                                                                 | 2026-08-03 |
| Recent run rate              | ~19–38/month — about one visitor a day **reaching Shopify**                                                                                    | 2026-08-03 |
| Sources, last 180 days       | direct 146, social 16, **search 7**, unknown 3, email 1                                                                                        | 2026-08-03 |
| Funnel, trailing 12 months   | 574 sessions → 23 carts → 20 reached checkout → **0 completed**                                                                                | 2026-08-03 |
| Checkout status              | **Not indicted, not cleared.** Inventory, payments, login-at-checkout and US shipping rates all verified correct. Needs one real test purchase | 2026-08-03 |

**Read "direct 146" again in this light.** A referral that arrives without a
referrer header lands in `direct`, and a link from the Manus front door may well
do exactly that. So `direct` is not necessarily people typing the URL — it may be
the front door doing its job. **This is a hypothesis with two candidate causes and
no evidence separating them**, and it is not to be reported as a finding until
the Manus analytics are read.

### Catalogue and price ladder

50 active products, $19.99–$650.

| Rung      | Offer                                                                | Price              |
| --------- | -------------------------------------------------------------------- | ------------------ |
| Entry     | Remote Tune Readiness Review                                         | $49 / $75          |
| Entry+    | ECU Tune File Review — GM/Ford/Dodge                                 | $99 / $149 / $199  |
| Core      | GM, Ford, Dodge/Mopar, Toyota/Lexus custom ECU tuning                | $400–$650          |
| Core      | Holley EFI Tuning & Diagnostics                                      | $350 / $450 / $650 |
| Adjacent  | Wiring & EFI power diagnostics                                       | $75–$250           |
| Adjacent  | Dodge/Mopar PCM unlock, removal, reinstall                           | $75–$300           |
| Recurring | Shop-to-shop support session                                         | $150 / $250 / $350 |
| Digital   | Holley EFI calibrations, LS swap toolkit, cam-swap pack, calculators | $39.99–$399        |
| Licence   | Professional Shop Licence — GM toolkit                               | $399               |
| Merch     | Print-on-demand apparel and decor                                    | $18.77–$64.68      |

### Capabilities

GM Gen III/IV/V LS and LT · Holley EFI (HP, Dominator, Terminator X) ·
HP Tuners · Ford Coyote and EcoBoost · Dodge/Mopar HEMI and PCM unlock ·
Toyota/Lexus · 4L60E and 4L80E transmission calibration · cam swaps ·
boost control · performance wiring and EFI power diagnostics · datalog review.

### Restrictions — non-negotiable

- **Never guarantee a power figure, a result, or that a tune will fix an
  undiagnosed problem.**
- **Never market emissions-equipment defeat**, or imply a tune makes an
  off-road-only modification street legal.
- Safety-critical faults **stop and escalate** before anything is published.
- Never fabricate a customer, review, dyno figure, result or endorsement. With
  three customers there is no testimonial library, and inventing one is
  disqualifying.
- Technical forums generally ban unmarked solicitation. Lead with the answer,
  disclose the commercial interest, link only when relevant.

---

## Venture 2 — Georgia Opportunity Ledger

Subscription intelligence for commercial property, business funding and market
pricing in Georgia. Code lives in this repository.

### Systems

| System         | Identifier                                                                           | Verified   |
| -------------- | ------------------------------------------------------------------------------------ | ---------- |
| Supabase       | `bbgikfblcahhvrpxiqnd` — ACTIVE_HEALTHY, us-east-1, free tier                        | 2026-07-31 |
| Stripe         | Same account. 4 products, 6 prices, all live mode, all wired to `subscription_plans` | 2026-07-31 |
| Hosting        | **None — not deployed anywhere.** Owner's intent, 2026-08-13: run it through the     |            |
|                | Manus front door. Feasibility unestablished — see open question 4 and `RUNBOOK.md`   | 2026-08-13 |
| Reference data | 159 counties, 12 industries, 12 sources loaded. 0 opportunities, 0 users             | 2026-07-31 |

### Plans

| Plan                                  | Monthly | Annual | Rank |
| ------------------------------------- | ------- | ------ | ---- |
| Free Preview                          | $0      | $0     | 0    |
| Weekly Report                         | $15     | $150   | 10   |
| Detailed Intelligence _(recommended)_ | $39     | $390   | 20   |
| Premium Alerts & Database             | $99     | $990   | 30   |

### Blockers

1. **Not deployed.** No webhook, no signing secret, no test-payment matrix.
2. **Legal review pending** on all ten documents in `src/lib/legal/documents.ts`.
   Each renders an "awaiting legal review" banner. **No paid or partner-facing
   campaign may launch until this clears.**
3. Migration history on the live database does not match this repository — see
   `docs/RUNBOOK.md`.

### Restrictions — non-negotiable

The product is **not** a brokerage, MLS, lender, investment adviser, legal
service or appraisal service. Nothing it publishes may guarantee eligibility,
financing or performance. Scores rank opportunities against each other; they are
not predictions. This is enforced in code and copy, not just a footer.

---

## Channels

| Channel                     | State                                                                        | Verified              |
| --------------------------- | ---------------------------------------------------------------------------- | --------------------- |
| **Manus front door**        | **Live. The entry point for everything. Traffic and conversion unread**      | 2026-08-13 _(stated)_ |
| Shopify storefront          | Live as a checkout behind the front door; transacting capability unproven    | 2026-08-03            |
| Stripe + bookipay invoicing | Live, dormant 11 months                                                      | 2026-08-03            |
| Organic search              | **Unknown.** 7 visits/180d _to Shopify_; the front door's own search traffic |                       |
|                             | has never been read                                                          | 2026-08-13            |
| Social                      | Minimal (16 visits / 180 days _to Shopify_). Accounts `UNKNOWN`              | 2026-08-03            |
| Email                       | Effectively unused (1 visit / 180 days _to Shopify_). No list size known     | 2026-08-03            |
| Paid advertising            | **Never used. No account, no budget, no approval**                           | 2026-08-03            |

**The channel that produced the three paying customers is `UNKNOWN`.** Nobody
recorded it. Establishing it is worth more than most campaigns — ask them.

**"Organic search: effectively zero" was downgraded to `UNKNOWN` on 2026-08-13**,
not because new evidence contradicted it but because the evidence behind it was
found to describe the wrong page. That is the correct direction for a claim whose
support has been withdrawn: it goes back to unknown, not to its opposite.

---

## Open questions

Rev should try to close these, and must not paper over them.

1. Where did the three customers come from?
2. ~~What is on `dd84tuning.com`, and how does it relate to the Shopify store?~~
   **Answered by the owner, 2026-08-13:** it is a Manus site and it is the front
   door; Shopify sits behind it. Rev could not verify this and cannot at present.
3. **What do the Manus analytics say?** Sessions, sources and conversions for
   `dd84tuning.com`. This is now the highest-value unknown in the file — it
   settles whether the business has an audience problem or a conversion problem,
   which the Shopify numbers cannot. **Rev cannot read it: the domain is blocked
   by the network egress proxy and no Manus connector exists on this account.**
   Either connect Manus, or export the figures by hand.
4. **Can Manus host the Ledger at all?** The owner wants it there. It is a
   Next.js app needing server-side rendering, per-request auth, and thirteen cron
   jobs. Whether Manus supports that — or only static pages — is unestablished,
   and it decides whether the Vercel plan in `docs/RUNBOOK.md` is replaced or
   kept. **Do not assume either way.**
5. Does the Shopify checkout actually complete? Needs one test purchase.
6. Which social accounts exist, and who runs them?

**Closed by owner decision, 2026-08-07 — do not reopen:** what the ten invoices
were for, and whether the gaps in invoice numbering represent unpaid invoices.
