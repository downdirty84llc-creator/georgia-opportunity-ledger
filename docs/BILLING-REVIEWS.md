# Refund, dispute and fraud reviews

Billing managers and super administrators with verified MFA can open
`/admin/billing`. The admin dashboard shows the pending count. Check this queue
each business day and retain Stripe's own dispute notifications: a queue entry
does not respond to a dispute or extend its deadline.

The signed Stripe webhook records `charge.refunded`, `charge.dispute.created`
and `radar.early_fraud_warning.created`. Provider lookups follow the payment
intent through all invoice-payment pages to each invoice's subscription. A
local subscription is matched only when its Stripe customer also matches.
User metadata is not used to choose the affected account. Legacy charges without
a payment intent and unmatched subscriptions remain explicit manual reviews.
No additional charge-read API permission is required.

Open the event in Stripe, confirm the current case status, amount, customer and
deadline, then take any necessary action there. A partial refund or early fraud
warning alone does not automatically cancel a member's subscription. Record
either "No account change needed" or "Handled in Stripe" with the decision and
any action already taken. Pending work should remain pending. Review notes
contain no card details or sensitive dispute evidence; store that in Stripe.

Saving a review atomically records the decision and its audit entry. A second
review cannot replace the first. The review API independently checks active
billing staff, MFA, same origin and input validity. Its database function is
service-only and rechecks the actor's current role. Members cannot read these
notes, including notes about their own payment.

If processing fails, the event stays pending and the webhook returns HTTP 500
for Stripe's retry. Review is blocked until processing finishes. Investigate the
delivery error in Stripe, repair it and resend the existing event; do not mark
failed rows processed by hand. The application does not run a separate replay
scheduler. Successful redelivery clears the old processing error. Duplicate
deliveries preserve completed review decisions.

Deploy in this order: apply the additive migration, publish the tested app,
then add the three event types to the existing production webhook endpoint.
Retain all existing lifecycle events. Never send synthetic refund/dispute events
to production to test account handling; use unit tests, the disposable database
and the isolated Stripe sandbox.
