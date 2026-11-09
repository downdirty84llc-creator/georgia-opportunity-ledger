# Launch operating guide

Georgia Opportunity Ledger — November 6, 2026.

The site runs routine jobs without this computer. An administrator still owns
research accuracy, support, billing exceptions and recovery decisions.

## Start of each working day

1. Open `/admin` and review failed jobs, billing exceptions, pending corrections
   and support tickets. Read the specific error before retrying a job.
2. Check the support mailbox for Sentry alerts. A recovery message resolves the
   corresponding incident only after the latest job or monitor is healthy.
3. Review records due for reverification. Open each original source, check its
   current facts and dates, edit the record, and record the verification. A
   scheduled digest does not independently recheck a property or lender.

The two GSA property leads published November 6 need another source check before
the stated November 12 initial-offer date. No cutoff time was supplied; their
calendar timestamps are deliberately blank. Confirm the time with the seller
before entering a precise deadline. No asking price or title clearance is claimed.

## Research, corrections and publication

Use `/admin/opportunities` for records and `/admin/corrections` for reported
errors. Keep the official source URL, verification date, restrictions, risks and
next action current. Program maximums are not individual offers; seller-reported
building sizes are not independent measurements.

Move a draft through review and approval before publication. If an error could
mislead a customer, restrict or unpublish the record while checking it. Preserve
the audit trail and explain material corrections. Only mark a support or
correction item resolved after the underlying issue is handled.

The Corrections queue is available to reviewers, editors and super
administrators. Accept a verified correction, update its linked record or
report, then mark the request published. Rejected and published requests move
to Completed requests. Notes must be safe for the requester to read.

Launch research may use AI assistance under the owner's direction. Do not imply
that a separate researcher, reviewer, appraiser or attorney approved a record
unless that actually occurred.

## Reports and email

Review `/admin/reports`. The automatic digest compiles the completed
Thursday–Wednesday period and preserves an existing report or draft for it.
Recurring weekly email goes only to eligible members who have alerts enabled,
with plan limits and unsubscribe controls enforced at delivery.

The November 6 premium launch briefing is published for Premium access. Its
email distribution remains disabled. Turning it on is a separate sending action;
the owner's current recurring-email approval covers weekly reports.

## Billing and customer support

Use the existing Ledger Stripe account and billing review queue. Do not replay
live payments as a test. A successful first payment grants access; an unpaid
renewal gets three days after the last paid period ends. Card retries do not
extend that deadline. Cancellation retains access through the paid period.

Use `support@georgiaopportunityledger.com` for customer replies. Attachments are
disabled at launch; use original source links. Obtain authorization before a
refund or other money movement that the customer or owner has not requested.

Open `/admin/support` to handle submitted tickets. Support representatives,
billing managers and super administrators can review them. The queue shows the
requester's current email address for a manual reply from the support mailbox.
Saving a review assigns it to the reviewer and records the status and note in
the audit log; it does not send email. Resolve or close only after handling the
issue. Reopening clears the resolution date. If another reviewer changed the
request, reload before saving; stale reviews cannot overwrite newer work.

## Backups and an incident

Encrypted daily backups run at 08:37 UTC in the private backup repository. Each
run performs an isolated core-database restore check. The owner has confirmed a
separate recovery-key copy. Follow [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md); never
paste keys or restore production data into an unprotected test system.

Read the newest run and alert state before declaring a failure resolved. The
accepted recovery point is up to 24 hours; hosted Auth/API and provider settings
require additional recovery steps beyond the tested database restore.

## Before calling the full paid launch verified

- Finish the Netlify-hosted sandbox checkout and incoming webhook rehearsal.
- Complete the real-device and assistive-technology checks in
  [ACCESSIBILITY-AUDIT.md](ACCESSIBILITY-AUDIT.md).
- Have an administrator walk through the review/correction workflow and read a
  report at each tier. Do not change the owner's password: that recovery test
  remains deferred by the owner's instruction.

The catalogue starts small: four funding records, two commercial-property leads,
one weekly report, one premium briefing and BLS Georgia construction employment.
The pricing page states this scope. Do not promise unpublished market series or
a minimum volume of new opportunities.
