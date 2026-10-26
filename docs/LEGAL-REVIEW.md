# Legal review packet

**This is not legal advice, and nothing here clears the review.** It was
prepared by an engineer, not a lawyer, to make an attorney's time cheaper: the
documents in `src/lib/legal/documents.ts` are compared against what the code
actually does, so counsel reviews an accurate description rather than
discovering the mismatches themselves at an hourly rate.

Every `requiresReview: true` flag stays true until counsel says otherwise.
Setting one to `false` is the sign-off, and only the owner acting on counsel's
advice should do it.

This packet was carried over from the repository this application was first
built in, and **re-verified line by line against this one** on 2026-09-25.
Several facts changed in the move and are corrected below; nothing was ported
on trust.

**Engineering update: 2026-10-26, application revision `f643633`.** The owner
confirmed that no attorney review has been completed. The deletion path,
payment-grace wording, processor status and remaining operational checks below
have been updated. This is a targeted factual update, not a fresh verification
of every September statement or a legal sign-off. All nine review flags remain
set.

---

## Implementation history and current review gaps

This section records five original gaps and the implementation that addressed
them. Implemented controls do not establish that every published promise is
accurate or that live operations have been verified. In particular, the
payment-grace wording identified below still differs from the access rule.

Four were built (§1–§4). The fifth (§5) was closed by publishing figures the
server already enforced, on an owner decision of 2026-09-25; no legal document
was changed to close it.

Production backup/restore, an operational scanner, staging billing checks,
verified launch content and a human accessibility review remain open. The owner
has no existing always-on server and has retained a no-cost service limit.
These constraints must be resolved before describing the service as ready for
paid launch. The engineering findings and counsel's review are separate gates.

### 1. Account deletion — ~~promised, not built~~ **built**

> _Privacy Policy, "Your controls":_ "From your account you can … request
> deletion of your account." … "A deletion request removes your profile,
> preferences, saved records and saved searches."

**Resolved.** `POST /api/v1/account/deletion` records the request and closes
the account immediately; `DELETE` withdraws it. The control is on the account
page behind a typed `DELETE` confirmation.

Access ends at once — `effective_access_rank` returns 0 for any account that is
not active — but the data survives a **30-day grace window**
(`DELETION_GRACE_DAYS` in `src/lib/account/deletion.ts`), after which the daily
`prune` job calls `accounts_due_for_purge` and purges it. That ordering is
deliberate: deletion is irreversible, so a mistake or a compromised session
should not destroy an account outright.

The daily job first calls `claim_account_for_purge` for the exact expired
request under a profile row lock, then calls `auth.admin.deleteUser`. It does
not issue a direct SQL deletion. A successful cancellation that wins the lock
prevents the claim. Claims remain closed and retryable if the provider call
fails or times out; they are not released merely because the outcome is unknown.
See `src/lib/jobs/maintenance-jobs.ts` and migrations
`20261012170000_enforce_account_deletion_window.sql` and
`20261012190000_claim_accounts_before_purge.sql` for the current implementation.

The resulting cascade takes the profile,
preferences, saved records, saved searches, alert preferences, notifications
and the subscription cache; `audit_logs`, `billing_events`, `analytics_events`,
`support_tickets` and `correction_requests` are `on delete set null`, so they
survive with their referencing user columns cleared. Clearing those columns
does not establish that free text, JSON payloads, provider records or backups
contain no identifying information. Counsel should review those retention
surfaces before treating this as complete anonymization. The append-only audit
trail is not rewritten by someone closing their account.

During the 30-day window, password sign-in lets a closed account reach the
account page to withdraw the request; it does not itself reopen the account.
Cancellation is refused after the deadline even if the daily purge has not yet
run. Database checks also prevent moving the deadline to evade that rule.

One guard detail worth counsel knowing: `request_account_deletion` raises
unless the caller's `account_status` is `active`, so a **suspended** account
cannot close itself — closing and reopening cannot be used to escape a
suspension.

Migration: `20260804003224_account_deletion.sql`.

### 2. Data export — ~~promised, not built~~ **built**

> _Privacy Policy, "Your controls":_ "you can … request an export of your data"

**Resolved.** `GET /api/v1/account/data-export` returns the member's own
record as a JSON download: profile, preferences, subscription summary, saved
records and notes, saved searches, alert preferences, notifications, support
tickets and correction requests. Distinct from `/api/v1/exports/opportunities`,
which remains the paid research product.

Everything is read through the **session-bound** client
(`createServerSupabaseClient`), so row-level security decides what is in the
file — the endpoint cannot over-share even if a query is wrong. It is delivered
inline under `Cache-Control: private, no-store` rather than through the
export-job pipeline, because storing a second copy of somebody's personal data
in a bucket to hand them their own record is worse on both privacy and latency.

### 3. Analytics opt-out — ~~promised twice, not built~~ **built**

> _Privacy Policy:_ "manage cookie preferences"
> _Cookie Policy, "Analytics":_ "You can opt out from your account without
> losing any functionality."

**Resolved.** `user_preferences.analytics_enabled` (migration
`20260803160830_analytics_consent.sql`, default `true`) is the flag; the
control is on `/account/preferences`; and `track()` checks it before writing to
`analytics_events` or forwarding to PostHog.

The consent lookup **fails closed** — the opposite of the rate limiter. If the
preference cannot be read, the event is dropped, because recording a member
whose consent cannot be confirmed is precisely what the policy forbids. It is
memoised for thirty seconds (`CONSENT_TTL_MS`) so a page of events costs one
read rather than several, and so an opt-out takes effect in seconds rather than
at the end of a session.

Counsel should confirm the wording and whether this opt-out default is suitable
for the jurisdictions and data processing actually in scope. Engineering has
not established that opt-out is legally sufficient. PostHog delivery is
conditional on configuration; its live configuration and funnel receipt have
not been verified in the October 26 readiness check.

### 4. Refund workflow — ~~described, not built~~ **built**

> _Refund Policy:_ "Refunds are approved by a billing manager and every refund
> action is recorded in the audit log."

**Resolved.** `POST /api/v1/admin/refunds` issues the refund through Stripe
and writes the `billing.refunded` entry via `log_admin_action`, so both halves
of the sentence are now true.

Access is a **role** check — billing manager or super administrator. A Premium
member has rank 30 and cannot reach it; a billing manager has no paid plan and
can. The audit entry is written _after_ Stripe confirms, so the trail can never
claim a refund that did not happen; if the entry itself fails the response says
`audited: false` rather than reporting clean.

Refunds still require a note explaining the approval, which is stored on both
the Stripe refund metadata and the audit entry.

### 5. Export limits — ~~the policy pointed at limits we did not publish~~ **closed**

> _Acceptable Use Policy, "Automated access":_ "Export exists for the
> legitimate version of this need and is subject to the limits published on the
> pricing page."

The limits existed and were enforced, but the pricing page published CSV export
only as a yes/no row per tier and no numbers at all, so the sentence sent a
member to a page that did not answer the question.

**Resolved on 2026-09-25 by owner decision: publish the numbers.** The
alternative on the table was rewording the policy; the owner chose to make the
page match the sentence rather than soften the sentence to match the page.

The pricing page now carries an **Export limits** row in the feature
comparison and a "How much can I export?" entry in the billing questions,
stating 5,000 rows per export and ten exports an hour, with anything over 500
rows prepared in the background.

**No legal document changed.** That is the point of this option — the
Acceptable Use Policy was already drafted correctly, and it became true the
moment the page it points at carried the figures.

Two properties worth counsel knowing:

- The published figures are **imported from the constants the server
  enforces** (`MAX_EXPORT_ROWS`, `RATE_LIMITS.export`,
  `ASYNC_EXPORT_THRESHOLD`) rather than typed into marketing copy. A change to
  a limit changes the published term in the same commit. A stated term that
  can silently drift from the enforced one is the failure mode this avoids.
- The caps are **global, not per-tier** — they apply to whichever tiers include
  export. They are presented that way rather than implying a per-plan
  allowance that does not exist.

---

## Document inventory

There are **twelve** documents. Earlier drafts of this packet, written against
the first repository, said ten; two more — the Acceptable Use Policy and the
Accessibility Statement — exist here and are flagged for review. **Counsel
should be quoted for twelve, of which nine need review.**

The three editorial documents are marked as not requiring review, on the
reasoning that they state our own internal practice rather than creating
obligations — which is itself a question worth putting to counsel, since
published standards can be read as representations. That split is pinned in
`tests/unit/legal/documents.test.ts` rather than left to memory, so flipping a
flag without deciding to flip it fails the build.

| #   | Slug                  | Title                          | Flagged for review |
| --- | --------------------- | ------------------------------ | ------------------ |
| 1   | `terms`               | Terms of Service               | yes                |
| 2   | `privacy`             | Privacy Policy                 | yes                |
| 3   | `subscription-terms`  | Subscription Terms             | yes                |
| 4   | `refunds`             | Refund and Cancellation Policy | yes                |
| 5   | `editorial-standards` | Editorial Standards            | **no**             |
| 6   | `corrections`         | Corrections Policy             | **no**             |
| 7   | `data-sources`        | Data Source Policy             | **no**             |
| 8   | `cookies`             | Cookie Policy                  | yes                |
| 9   | `copyright`           | Copyright Policy               | yes                |
| 10  | `disclaimers`         | Disclaimers                    | yes                |
| 11  | `acceptable-use`      | Acceptable Use Policy          | yes                |
| 12  | `accessibility`       | Accessibility Statement        | yes                |

---

## What was verified as accurate

Offered so counsel can spend their time on the drafting rather than on
confirming the engineering. Each of these was checked against the code in this
repository on 2026-09-25:

- **Payment-grace mismatch found October 26; unresolved.** Subscription Terms
  describe access continuing "while the card is retried and for three days
  afterwards". `subscriptionAccessRank` instead grants a past-due Stripe
  subscription access through its settled `paidThrough` date plus three days;
  it does not wait until Stripe finishes retrying. A longer retry schedule can
  outlast paid access. Counsel and the owner must reconcile the wording with
  this behavior. Do not treat the earlier claim that they match as sign-off.
- **Downgrades defer to period end.** `change-plan` sets the proration
  behaviour by direction and does not apply a downgrade mid-period.
- **A suspended account can still appeal.** The `support_tickets_insert` policy
  admits an insert from a non-active account when `category = 'account'`, which
  is what both the Terms and the Acceptable Use Policy describe when they say
  "suspension is not deletion".
- **Card data is never received.** Checkout and the customer portal are hosted
  by Stripe; no card number reaches this application or its database.
- **Automation requires a terms review.** The Data Source Policy claims this is
  "enforced by a database constraint, not by policy alone". It is — the
  `automation_requires_review` check constraint in
  `…000600_sources.sql` refuses `automation_allowed = true` without a recorded
  permissive review.
- **The audit log cannot be rewritten.** `audit_logs` has no update or delete
  policy for any role, including super administrators.
- **The accessibility claims are built, and the statement's own hedge is
  honest.** A skip link is the first element in `src/app/layout.tsx`; status is
  never carried by colour alone (the `Pill` primitive types its children as
  required, so the compiler refuses a colour-only badge); reduced motion is
  respected globally. Automated accessibility suites
  (`tests/e2e/accessibility.spec.ts`,
  `tests/e2e/accessibility-authenticated.spec.ts`) run in CI on every change.
  The statement does **not** claim conformance — it says we have built for
  WCAG 2.1 AA and that no audit by people using assistive technology has been
  carried out. That is accurate, and counsel should be aware it is a
  deliberately weaker claim than a conformance statement.

---

## Questions for counsel

Grouped so they can be answered in one pass.

**Jurisdiction and consumer law**

1. The service is Georgia-focused but sold online to anyone. Which state
   privacy regimes are assumed to apply, and does the Privacy Policy need
   CCPA/CPRA-specific disclosures and a "Do Not Sell or Share" position?
2. Automatic renewal: are the pre-checkout disclosures and cancellation path
   sufficient under applicable automatic-renewal laws? Cancellation is
   self-service through the Stripe portal, which is the strong position, but
   the disclosure wording has not been reviewed.
3. Is the liability cap (twelve months of fees) enforceable as drafted, and
   does it need a conspicuousness treatment — capitals, separate acceptance —
   rather than sitting as ordinary body text?

**The product's core risk**

4. The Disclaimers are the load-bearing document: the product reports on
   property and funding without being a broker, lender or adviser. Are the
   real-estate and funding disclaimers sufficient to avoid an
   unlicensed-brokerage or loan-brokering characterisation in Georgia?
5. Scores are presented as a ranking, explicitly "not predictions of outcome".
   Is that framing adequate, given members pay for the scoring?
6. Tax and sheriff sale coverage mentions redemption periods and encumbered
   title. Does this need stronger, more prominent warning given the potential
   loss?

**Content and sources**

7. The compilation is claimed as proprietary while underlying facts are not.
   Is the intellectual-property section adequate for a database of public
   facts?
8. Copyright: does the takedown section need formal DMCA safe-harbour
   structure — a registered agent, the statutory elements, a counter-notice
   procedure — or is the informal process defensible given we publish our own
   compilation rather than host user uploads?
9. Redistribution is confirmed per source before publication. Is per-source
   terms review plus attribution a sufficient posture?

**Acceptable use and enforcement**

10. The Acceptable Use Policy provides for suspension and for ending a
    subscription "without a refund for the remaining period" on redistribution
    at scale, automated extraction, or attempts to reach another member's data.
    Is forfeiture of the paid remainder enforceable as drafted, and does it sit
    correctly against the Refund Policy and applicable automatic-renewal law?
11. Seat sharing is prohibited but not technically prevented — there is no
    concurrent-session detection or device binding. Does a prohibition we do
    not enforce in software weaken the term, and should the policy say how a
    breach would be evidenced?
12. The security-research section offers not to pursue good-faith researchers.
    Should that be a formal safe-harbour clause with defined scope, or is the
    informal wording preferable?

**Accessibility**

13. The Accessibility Statement is a public representation about a service sold
    to the public. What ADA Title III or state-law exposure does publishing it
    create or reduce, and is "built for WCAG 2.1 AA, not yet audited" the right
    thing to say — or does an unaudited statement invite the claim it is trying
    to pre-empt?
14. It commits to responding within two working days and to supplying
    information in another format at no cost, to subscribers and
    non-subscribers alike. Is that an enforceable undertaking we should be
    making before anyone is staffed to honour it?

**Operational**

15. Should the three editorial documents (5–7 above) also be reviewed, given
    published standards may be read as representations?
16. What retention periods should replace the current general statement that
    billing records are kept "where we are required to keep them"?
17. Which processor disclosures, agreements and retention commitments are
    needed for the verified configuration? Supabase and Stripe serve the
    application; Resend sends mail; Zoho receives support replies; Sentry
    receives explicitly reported server errors. PostHog exists in the code but
    its live delivery remains unverified. Netlify is a protected staging
    preview, not the production host. A proposed scanner has not been connected
    to production. Recheck this inventory after infrastructure decisions.
18. Does clearing user foreign keys meet the deletion wording when retained
    JSON, support text, external provider records and backup copies may still
    identify a member? Specify the necessary retention and removal process.

---

## Suggested order

1. Record the exact source revision and document versions supplied to counsel.
   The export-limit decision (§5) was already made on September 25; do not ask
   the owner to repeat it. Resolve the payment-grace mismatch and confirm the
   actual processor and retention arrangements.
2. Counsel reviews all twelve, answering the questions above. Record reviewer,
   review date, approved document versions and any conditions for each of the
   nine flagged documents.
3. Corrections applied to `src/lib/legal/documents.ts`.
4. `requiresReview` flipped to `false` per document as each is signed off, and
   the date and reviewer recorded. `tests/unit/legal/documents.test.ts` pins
   the current split, so it must be updated in the same change — which is the
   point: the flag cannot move by accident.
5. The launch checklist item in `RUNBOOK.md` is ticked only when all nine
   flagged documents are cleared.
