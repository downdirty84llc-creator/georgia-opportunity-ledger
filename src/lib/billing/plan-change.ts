import type Stripe from 'stripe';

export class BillingConflict extends Error {}

const idOf = (value: string | { id: string }) =>
  typeof value === 'string' ? value : value.id;

type Phase = Stripe.SubscriptionScheduleUpdateParams.Phase;

/** Copy the editable settings; expanded Stripe objects are never sent back. */
export function copyPhase(source: Stripe.SubscriptionSchedule.Phase): Phase {
  if (
    source.add_invoice_items.length ||
    source.application_fee_percent ||
    source.transfer_data ||
    source.on_behalf_of ||
    source.billing_thresholds ||
    source.items.some((item) => item.billing_thresholds)
  ) {
    throw new Error(
      'This subscription needs a billing specialist to change its schedule. Contact support.',
    );
  }
  const discounts = (items: Stripe.SubscriptionSchedule.Phase.Discount[]) =>
    items.map((item) => {
      if (item.discount) return { discount: idOf(item.discount) };
      if (item.promotion_code)
        return { promotion_code: idOf(item.promotion_code) };
      if (item.coupon) return { coupon: idOf(item.coupon) };
      throw new Error('Unrecognised Stripe discount');
    });
  return {
    start_date: source.start_date,
    end_date: source.end_date,
    items: source.items.map((item) => ({
      price: idOf(item.price),
      quantity: item.quantity,
      discounts: discounts(item.discounts),
      tax_rates: item.tax_rates?.map(idOf),
      metadata: item.metadata ?? undefined,
    })),
    discounts: discounts(source.discounts),
    default_tax_rates: source.default_tax_rates?.map(idOf),
    automatic_tax: source.automatic_tax
      ? {
          enabled: source.automatic_tax.enabled,
          liability: source.automatic_tax.liability
            ? {
                type: source.automatic_tax.liability.type,
                account: source.automatic_tax.liability.account
                  ? idOf(source.automatic_tax.liability.account)
                  : undefined,
              }
            : undefined,
        }
      : undefined,
    default_payment_method: source.default_payment_method
      ? idOf(source.default_payment_method)
      : undefined,
    collection_method: source.collection_method ?? undefined,
    currency: source.currency,
    description: source.description ?? undefined,
    billing_cycle_anchor: source.billing_cycle_anchor ?? undefined,
    metadata: source.metadata ?? undefined,
    trial_end: source.trial_end ?? undefined,
    proration_behavior: source.proration_behavior,
    invoice_settings: source.invoice_settings
      ? {
          account_tax_ids: source.invoice_settings.account_tax_ids?.map(idOf),
          days_until_due: source.invoice_settings.days_until_due ?? undefined,
          custom_fields: source.invoice_settings.custom_fields ?? undefined,
          description: source.invoice_settings.description ?? undefined,
          footer: source.invoice_settings.footer ?? undefined,
          issuer: source.invoice_settings.issuer
            ? {
                type: source.invoice_settings.issuer.type,
                account: source.invoice_settings.issuer.account
                  ? idOf(source.invoice_settings.issuer.account)
                  : undefined,
              }
            : undefined,
        }
      : undefined,
  };
}

export async function changeSubscriptionPlan(
  client: Stripe,
  existing: Stripe.Subscription,
  target: {
    priceId: string;
    planCode: string;
    interval: 'monthly' | 'annual';
    direction: 'upgrade' | 'downgrade' | 'same';
  },
  operationId: string,
) {
  const item = existing.items.data[0];
  if (
    !item ||
    existing.items.data.length !== 1 ||
    item.quantity !== 1 ||
    !['active', 'trialing'].includes(existing.status)
  ) {
    throw new BillingConflict(
      'Resolve your current subscription in the billing portal before changing plans.',
    );
  }
  if (
    existing.cancel_at_period_end ||
    existing.cancel_at ||
    existing.pending_update ||
    existing.pause_collection
  ) {
    throw new BillingConflict(
      'Your subscription has a cancellation, payment, or pause pending. Resolve it in the billing portal first.',
    );
  }
  if (item.price.id === target.priceId && !existing.schedule) {
    throw new BillingConflict(
      'You already have this plan and billing interval.',
    );
  }
  if (target.direction === 'upgrade') {
    if (existing.schedule) {
      throw new BillingConflict(
        'A plan change is already scheduled. Contact support to replace it with an immediate upgrade.',
      );
    }
    const updated = await client.subscriptions.update(
      existing.id,
      {
        items: [
          { id: item.id, price: target.priceId, quantity: item.quantity },
        ],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        expand: ['latest_invoice'],
      },
      { idempotencyKey: `ledger:plan:${operationId}` },
    );
    const invoice =
      typeof updated.latest_invoice === 'object'
        ? updated.latest_invoice
        : null;
    return {
      direction: target.direction,
      plan: target.planCode,
      effective: updated.pending_update ? 'payment_required' : 'immediately',
      url: updated.pending_update
        ? (invoice?.hosted_invoice_url ?? null)
        : null,
      message: updated.pending_update
        ? 'Complete payment to activate your upgrade. Your current plan remains in place until payment succeeds.'
        : 'Your upgrade has been paid and applied. Your account will refresh when Stripe confirms the change.',
    };
  }

  let schedule: Stripe.SubscriptionSchedule;
  if (existing.schedule) {
    schedule = await client.subscriptionSchedules.retrieve(
      idOf(existing.schedule),
    );
    if (schedule.metadata?.ledger_plan_change !== 'true') {
      // Recover a crash between creating the schedule and tagging/updating it.
      // Only a replay of this operation's original creation can establish that
      // this untagged schedule belongs to us. An unrelated schedule is refused.
      try {
        const original = await client.subscriptionSchedules.create(
          { from_subscription: existing.id },
          {
            idempotencyKey: `ledger:schedule:${operationId}`,
          },
        );
        if (original.id !== schedule.id)
          throw new Error('Schedule identity changed');
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'type' in error &&
          error.type === 'StripeInvalidRequestError'
        ) {
          throw new BillingConflict(
            'This subscription already has a custom schedule. Contact support before changing it.',
          );
        }
        throw error;
      }
    }
  } else {
    schedule = await client.subscriptionSchedules.create(
      { from_subscription: existing.id },
      {
        idempotencyKey: `ledger:schedule:${operationId}`,
      },
    );
  }
  const current = schedule.phases.find(
    (phase) => phase.start_date === schedule.current_phase?.start_date,
  );
  if (!current || !item.current_period_end)
    throw new Error('Stripe did not return the current billing period');
  const preserved = copyPhase(current);
  const periodEnd = item.current_period_end;
  await client.subscriptionSchedules.update(
    schedule.id,
    {
      end_behavior: 'release',
      proration_behavior: 'none',
      metadata: { ledger_plan_change: 'true' },
      phases: [
        { ...preserved, end_date: periodEnd },
        {
          ...preserved,
          start_date: periodEnd,
          end_date: undefined,
          duration: {
            interval: target.interval === 'annual' ? 'year' : 'month',
            interval_count: 1,
          },
          items: [{ ...preserved.items[0], price: target.priceId }],
          trial_end: undefined,
          trial: undefined,
          billing_cycle_anchor: 'phase_start',
          proration_behavior: 'none',
          metadata: { ...preserved.metadata, plan_code: target.planCode },
        },
      ],
    },
    { idempotencyKey: `ledger:schedule-update:${operationId}` },
  );
  return {
    direction: target.direction,
    plan: target.planCode,
    effective: 'end_of_period',
    effectiveAt: new Date(periodEnd * 1000).toISOString(),
    message:
      'Your plan and billing interval will change when your current paid period ends.',
  };
}
