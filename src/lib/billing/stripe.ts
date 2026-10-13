import Stripe from 'stripe';

import { serverEnv } from '@/lib/env';

let client: Stripe | null = null;

/**
 * Stripe client.
 *
 * Pin the API version with the SDK. The SDK otherwise sends its own default,
 * not the version selected in the Dashboard. Webhooks accept both invoice and
 * subscription shapes while the endpoint's event version is upgraded separately.
 */
export function stripe(): Stripe {
  if (client) return client;
  client = new Stripe(serverEnv().stripeSecretKey, {
    apiVersion: '2026-09-30.endive',
    typescript: true,
    timeout: 8_000,
    maxNetworkRetries: 0,
    appInfo: {
      name: 'Georgia Opportunity Ledger',
      version: '0.1.0',
    },
  });
  return client;
}

export type BillingInterval = 'monthly' | 'annual';

export interface PlanPricing {
  planId: string;
  code: string;
  name: string;
  monthlyPriceId: string | null;
  annualPriceId: string | null;
  accessRank: number;
}

export function priceIdFor(
  plan: PlanPricing,
  interval: BillingInterval,
): string | null {
  return interval === 'annual' ? plan.annualPriceId : plan.monthlyPriceId;
}

/**
 * Whether moving between two ranks is an upgrade, a downgrade, or neither.
 * Drives both the proration behaviour and the analytics event.
 */
export function planChangeDirection(
  fromRank: number,
  toRank: number,
): 'upgrade' | 'downgrade' | 'same' {
  if (toRank > fromRank) return 'upgrade';
  if (toRank < fromRank) return 'downgrade';
  return 'same';
}

/**
 * Proration policy.
 *
 * Upgrades take effect immediately and are prorated, because the member is
 * asking for access now. Downgrades take effect at the end of the paid period
 * — they have already paid for it, and clawing access back mid-period would be
 * the wrong side of the promise in spec 9.
 */
export function prorationBehaviorFor(
  direction: 'upgrade' | 'downgrade' | 'same',
): Stripe.SubscriptionUpdateParams.ProrationBehavior {
  return direction === 'upgrade' ? 'always_invoice' : 'none';
}

export function toDate(seconds: number | null | undefined): Date | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}
