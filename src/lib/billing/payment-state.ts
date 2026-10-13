import type Stripe from 'stripe';
import { fromStripeStatus } from './subscription';

/** Stripe's current period can advance before a renewal is actually paid. */
export async function subscriptionPaymentState(
  client: Stripe,
  subscription: Stripe.Subscription,
  previousPaidThrough: string | null = null,
) {
  const item = subscription.items.data[0];
  const legacy = subscription as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };
  const periodStart =
    item?.current_period_start ?? legacy.current_period_start ?? null;
  const periodEnd =
    item?.current_period_end ?? legacy.current_period_end ?? null;
  let paidThrough = previousPaidThrough
    ? Date.parse(previousPaidThrough) / 1000
    : 0;
  const latest =
    typeof subscription.latest_invoice === 'string'
      ? await client.invoices.retrieve(subscription.latest_invoice)
      : subscription.latest_invoice;

  let paidPriceId: string | null = null;
  let latestPaidEnd = 0;
  function paidEnd(invoice: Stripe.Invoice): number {
    if (invoice.status !== 'paid') return 0;
    return Math.max(
      0,
      ...invoice.lines.data
        .filter((line) => {
          const old = line as unknown as {
            type?: string;
            subscription?: string;
          };
          const details = line.parent?.subscription_item_details;
          return (
            (details?.subscription === subscription.id ||
              old.subscription === subscription.id) &&
            line.amount >= 0
          );
        })
        .map((line) => {
          const old = line as unknown as { price?: { id: string } };
          const price = line.pricing?.price_details?.price ?? old.price?.id;
          const priceId =
            typeof price === 'string' ? price : (price?.id ?? null);
          if (
            line.period.end > latestPaidEnd ||
            (line.period.end === latestPaidEnd && priceId === item?.price.id)
          ) {
            latestPaidEnd = line.period.end;
            paidPriceId = priceId;
          }
          return line.period.end;
        }),
    );
  }
  if (latest) paidThrough = Math.max(paidThrough, paidEnd(latest));
  // Recover payment evidence after a missed webhook or a cache rebuild. This
  // query is bounded; ordinary subscriptions have one recurring invoice per
  // period. Failure is retried rather than silently provisioning unpaid access.
  if (
    (!paidThrough ||
      (periodEnd && paidThrough < periodEnd) ||
      latest?.status !== 'paid') &&
    subscription.status !== 'trialing'
  ) {
    const invoices = await client.invoices.list({
      subscription: subscription.id,
      customer:
        typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id,
      status: 'paid',
      limit: 100,
    });
    paidThrough = Math.max(paidThrough, ...invoices.data.map(paidEnd));
    if (!paidThrough && invoices.has_more)
      throw new Error('Paid subscription history requires reconciliation');
  }
  let status = fromStripeStatus(subscription.status);
  if (
    status === 'active' &&
    (!periodEnd || paidThrough < periodEnd || paidPriceId !== item?.price.id)
  ) {
    // Asynchronous payments can leave Stripe "active" even after the invoice
    // fails and is voided. Access follows settled invoices, never that flag.
    status = paidThrough ? 'past_due' : 'incomplete';
  }
  if (status === 'canceled' && !paidThrough) status = 'expired';
  return {
    status,
    paidPriceId,
    paidThrough: paidThrough
      ? new Date(paidThrough * 1000).toISOString()
      : null,
    periodStart:
      periodStart === null ? null : new Date(periodStart * 1000).toISOString(),
    periodEnd:
      periodEnd === null ? null : new Date(periodEnd * 1000).toISOString(),
  };
}
