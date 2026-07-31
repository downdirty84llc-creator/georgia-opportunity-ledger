import type { Metadata } from 'next';
import Link from 'next/link';

import { BillingPortalButton } from '@/components/account/billing-portal-button';
import { CancelSubscriptionButton } from '@/components/account/cancel-subscription-button';
import {
  ButtonLink,
  Card,
  DataRow,
  Pill,
  SectionHeading,
} from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import {
  needsPaymentAttention,
  paidAccessEndsAt,
} from '@/lib/billing/subscription';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, formatMoney, titleCase } from '@/lib/format';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

export default async function BillingPage() {
  const session = await getSessionContext();
  const { viewer } = session;
  const supabase = await createServerSupabaseClient();

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select(
      `billing_interval, status, current_period_start, current_period_end,
       cancel_at_period_end, trial_end, canceled_at, founding_member,
       stripe_customer_id,
       subscription_plans ( code, name, monthly_price, annual_price )`,
    )
    .eq('user_id', viewer.userId)
    .maybeSingle();

  const plan = subscription
    ? Array.isArray(subscription.subscription_plans)
      ? subscription.subscription_plans[0]
      : subscription.subscription_plans
    : null;

  const accessEnds = paidAccessEndsAt(session.subscription);
  const attention = needsPaymentAttention(session.subscription);
  const price =
    subscription?.billing_interval === 'annual'
      ? Number(plan?.annual_price ?? 0)
      : Number(plan?.monthly_price ?? 0);

  const isPaid = viewer.planCode !== 'free';

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <SectionHeading
        eyebrow="Account"
        title="Billing"
        description="Payment methods, invoices and card details are held by Stripe. This application never receives a card number."
        action={
          subscription?.stripe_customer_id ? <BillingPortalButton /> : undefined
        }
      />

      {attention ? (
        <p className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Your last payment failed.</strong>{' '}
          We keep your access while the card is retried, plus three days. Update
          your payment method in the billing portal to avoid interruption —
          nothing you have saved will be lost either way.
        </p>
      ) : null}

      <Card>
        <h2 className="text-base font-semibold">Current subscription</h2>
        <dl className="mt-3">
          <DataRow label="Plan" value={session.planName} />
          <DataRow
            label="Status"
            value={
              <Pill
                tone={
                  session.subscriptionStatus === 'active' ||
                  session.subscriptionStatus === 'trialing'
                    ? 'positive'
                    : session.subscriptionStatus === 'free'
                      ? 'muted'
                      : 'warning'
                }
              >
                {titleCase(session.subscriptionStatus ?? 'free')}
              </Pill>
            }
          />
          {isPaid ? (
            <>
              <DataRow
                label="Billing interval"
                value={titleCase(subscription?.billing_interval ?? 'monthly')}
              />
              <DataRow label="Amount" value={formatMoney(price)} />
              <DataRow
                label="Current period started"
                value={formatDate(subscription?.current_period_start)}
              />
              <DataRow
                label={
                  session.cancelAtPeriodEnd ? 'Access ends' : 'Next renewal'
                }
                value={formatDate(
                  accessEnds ?? subscription?.current_period_end,
                )}
              />
            </>
          ) : null}
          {subscription?.trial_end ? (
            <DataRow
              label="Trial ends"
              value={formatDate(subscription.trial_end)}
            />
          ) : null}
          {subscription?.founding_member ? (
            <DataRow
              label="Founding member"
              value={<Pill tone="positive">Price locked</Pill>}
            />
          ) : null}
        </dl>

        {session.cancelAtPeriodEnd ? (
          <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
            Your subscription is set to end at the close of the period you have
            already paid for. Until then nothing changes. Afterwards your
            account stays open at the free tier and everything you have saved is
            kept.
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <ButtonLink
            href="/pricing"
            variant={isPaid ? 'secondary' : 'primary'}
          >
            {isPaid ? 'Change plan' : 'Choose a plan'}
          </ButtonLink>
          {isPaid && !session.cancelAtPeriodEnd ? (
            <CancelSubscriptionButton />
          ) : null}
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="text-base font-semibold">Invoices and payment method</h2>
        <p className="mt-2 text-sm text-ink-700">
          Your invoice history, receipts and card details live in the Stripe
          customer portal. Open it to download an invoice, change your card, or
          update your billing address.
        </p>
        <div className="mt-4">
          {subscription?.stripe_customer_id ? (
            <BillingPortalButton />
          ) : (
            <p className="text-sm text-ink-500">
              There is no billing record for this account yet. One is created
              the first time you subscribe.
            </p>
          )}
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="text-base font-semibold">How billing works here</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>
            <strong className="font-semibold">Upgrades</strong> take effect
            immediately and are prorated — you pay only the difference for the
            rest of the current period.
          </li>
          <li>
            <strong className="font-semibold">Downgrades</strong> take effect at
            the end of the period you have already paid for. You keep the higher
            tier until then.
          </li>
          <li>
            <strong className="font-semibold">Cancellation</strong> stops the
            next renewal. Access continues to the period end, then the account
            returns to the free tier.
          </li>
          <li>
            <strong className="font-semibold">Failed payments</strong> keep your
            access through the paid period plus a three-day grace window while
            the card is retried.
          </li>
        </ul>
        <p className="mt-4 text-sm text-ink-600">
          Full detail in the{' '}
          <Link href="/legal/subscription-terms" className="underline">
            subscription terms
          </Link>{' '}
          and the{' '}
          <Link href="/legal/refunds" className="underline">
            refund policy
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
