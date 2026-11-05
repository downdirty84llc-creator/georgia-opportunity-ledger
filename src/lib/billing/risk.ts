import type Stripe from 'stripe';
import { stripe } from '@/lib/billing/stripe';
import { createAdminClient } from '@/lib/db/admin';

export const RISK_EVENTS = [
  'charge.refunded',
  'charge.dispute.created',
  'radar.early_fraud_warning.created',
] as const;

export function isBillingRiskEvent(type: string): boolean {
  return RISK_EVENTS.some((event) => event === type);
}

function id(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

export interface BillingRiskContext {
  livemode: boolean;
  objectId: string;
  chargeId: string | null;
  paymentIntentId: string | null;
  customerIds: string[];
  invoiceIds: string[];
  subscriptionIds: string[];
  amount: number | null;
  currency: string | null;
  detail: string;
  dueAt: number | null;
  resolution: 'matched' | 'manual_review';
}

/** Derive relationships from provider objects, never editable user metadata. */
export async function recordBillingRisk(event: Stripe.Event): Promise<void> {
  const object = event.data.object as
    Stripe.Charge | Stripe.Dispute | Stripe.Radar.EarlyFraudWarning;
  const charge = object.object === 'charge' ? object : null;
  const dispute = object.object === 'dispute' ? object : null;
  const context: BillingRiskContext = {
    livemode: event.livemode,
    objectId: object.id,
    chargeId: charge?.id ?? id('charge' in object ? object.charge : null),
    paymentIntentId: id(object.payment_intent),
    customerIds: charge && id(charge.customer) ? [id(charge.customer)!] : [],
    invoiceIds: [],
    subscriptionIds: [],
    amount: charge?.amount_refunded ?? dispute?.amount ?? null,
    currency: charge?.currency ?? dispute?.currency ?? null,
    detail: charge
      ? charge.refunded
        ? 'Full refund'
        : 'Partial refund'
      : dispute
        ? `Dispute: ${dispute.reason}`
        : 'Early fraud warning',
    dueAt: dispute?.evidence_details.due_by ?? null,
    resolution: 'manual_review',
  };
  const subscriptionCustomers = new Map<string, string>();
  // Some legacy events have no PaymentIntent. Keep these as explicit manual
  // reviews with their charge/event link instead of guessing an account from
  // metadata or adding charge-read privileges to the production credential.
  if (context.paymentIntentId) {
    const client = stripe();
    const payments = client.invoicePayments.list({
      payment: {
        type: 'payment_intent',
        payment_intent: context.paymentIntentId,
      },
      status: 'paid',
      limit: 100,
    });
    // Auto-pagination is essential: one payment can cover several invoices.
    for await (const payment of payments) {
      const invoiceId = id(payment.invoice);
      if (!invoiceId || context.invoiceIds.includes(invoiceId)) continue;
      const invoice = await client.invoices.retrieve(invoiceId);
      context.invoiceIds.push(invoice.id);
      const customerId = id(invoice.customer);
      if (customerId && !context.customerIds.includes(customerId))
        context.customerIds.push(customerId);
      const subscriptionId =
        invoice.parent?.type === 'subscription_details'
          ? id(invoice.parent.subscription_details?.subscription)
          : null;
      if (subscriptionId && !context.subscriptionIds.includes(subscriptionId))
        context.subscriptionIds.push(subscriptionId);
      if (subscriptionId && customerId)
        subscriptionCustomers.set(subscriptionId, customerId);
    }
  }
  const db = createAdminClient();
  let matches: {
    id: string;
    user_id: string;
    stripe_customer_id: string;
    stripe_subscription_id: string;
  }[] = [];
  if (context.subscriptionIds.length) {
    const { data, error } = await db
      .from('subscriptions')
      .select('id,user_id,stripe_customer_id,stripe_subscription_id')
      .in('stripe_subscription_id', context.subscriptionIds);
    if (error) throw new Error(error.message);
    matches = (data ?? []).filter(
      (row: { stripe_customer_id: string; stripe_subscription_id: string }) =>
        subscriptionCustomers.get(row.stripe_subscription_id) ===
        row.stripe_customer_id,
    );
    if (matches.length === context.subscriptionIds.length)
      context.resolution = 'matched';
  }
  const { error } = await db
    .from('billing_events')
    .update({
      review_required: true,
      review_context: context,
      user_id: matches.length === 1 ? matches[0]!.user_id : null,
      subscription_id: matches.length === 1 ? matches[0]!.id : null,
      // Do not touch review fields: a concurrent delivery may finish after staff.
    })
    .eq('stripe_event_id', event.id);
  if (error) throw new Error(error.message);
}
