/**
 * Creates the plan catalogue in Stripe and writes the price ids onto
 * `subscription_plans`.
 *
 * Run it once per environment:
 *
 *   npm run stripe:setup          # uses STRIPE_SECRET_KEY from the environment
 *
 * The mode is decided entirely by the key you give it. A `sk_test_…` key builds
 * the test catalogue, a `sk_live_…` key builds the live one, and neither can
 * see the other — which is the point. There are no price ids committed to this
 * repository for exactly that reason: an id is only meaningful in the mode that
 * minted it, and hardcoding one guarantees that somebody eventually points a
 * live key at a test price.
 *
 * Idempotent. Products are matched on `metadata.plan_code`, prices on their
 * lookup key, so running it twice changes nothing. Prices are immutable in
 * Stripe, so if an amount here disagrees with an existing price the script
 * says so and does not silently create a duplicate — changing what an existing
 * subscriber pays is not something a setup script should do on its own.
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

interface PlanSpec {
  code: string;
  name: string;
  description: string;
  accessRank: number;
  /** In cents, matching spec 6. */
  monthly: number;
  annual: number;
}

const PRODUCT_LINE = 'georgia_opportunity_ledger';

const PLANS: readonly PlanSpec[] = [
  {
    code: 'free',
    name: 'Georgia Opportunity Ledger — Free Preview',
    description:
      'Free access: limited previews, the public weekly summary and market indicators.',
    accessRank: 0,
    monthly: 0,
    annual: 0,
  },
  {
    code: 'weekly',
    name: 'Georgia Opportunity Ledger — Weekly',
    description:
      'The full weekly report, searchable database access and the deadline calendar.',
    accessRank: 10,
    monthly: 1500,
    annual: 15000,
  },
  {
    code: 'detailed',
    name: 'Georgia Opportunity Ledger — Detailed',
    description:
      'Everything in Weekly plus detailed record analysis, saved searches and CSV export.',
    accessRank: 20,
    monthly: 3900,
    annual: 39000,
  },
  {
    code: 'premium',
    name: 'Georgia Opportunity Ledger — Premium',
    description:
      'Everything in Detailed plus immediate alerts, premium briefings and the full archive.',
    accessRank: 30,
    monthly: 9900,
    annual: 99000,
  },
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See .env.example.`);
    process.exit(1);
  }
  return value;
}

function lookupKey(code: string, interval: 'monthly' | 'annual'): string {
  return `gol_${code}_${interval}`;
}

async function findProduct(
  stripe: Stripe,
  code: string,
): Promise<Stripe.Product | null> {
  // `search` is eventually consistent, so a product created seconds ago may not
  // appear. Listing is slower but exact, and this script runs once.
  for await (const product of stripe.products.list({ limit: 100 })) {
    if (
      product.metadata.plan_code === code &&
      product.metadata.product_line === PRODUCT_LINE
    ) {
      return product;
    }
  }
  return null;
}

async function ensureProduct(
  stripe: Stripe,
  plan: PlanSpec,
): Promise<Stripe.Product> {
  const existing = await findProduct(stripe, plan.code);
  if (existing) {
    console.log(`  product ${plan.code}: reusing ${existing.id}`);
    return existing;
  }

  const created = await stripe.products.create({
    name: plan.name,
    description: plan.description,
    metadata: {
      plan_code: plan.code,
      access_rank: String(plan.accessRank),
      product_line: PRODUCT_LINE,
    },
  });
  console.log(`  product ${plan.code}: created ${created.id}`);
  return created;
}

async function ensurePrice(
  stripe: Stripe,
  product: Stripe.Product,
  plan: PlanSpec,
  interval: 'monthly' | 'annual',
): Promise<string | null> {
  const amount = interval === 'monthly' ? plan.monthly : plan.annual;

  // The free plan never goes through Checkout, so it gets no price at all.
  // A zero-amount recurring price would work and would also be a thing that
  // could be attached to a subscription by mistake.
  if (amount === 0) return null;

  const key = lookupKey(plan.code, interval);
  const { data: found } = await stripe.prices.list({
    lookup_keys: [key],
    limit: 1,
  });

  const existing = found[0];
  if (existing) {
    if (existing.unit_amount !== amount) {
      console.warn(
        `  price ${key}: EXISTS at ${existing.unit_amount} but the spec says ` +
          `${amount}. Left alone — changing what current subscribers pay is a ` +
          `deliberate migration, not a setup step.`,
      );
    } else {
      console.log(`  price ${key}: reusing ${existing.id}`);
    }
    return existing.id;
  }

  const created = await stripe.prices.create({
    product: product.id,
    unit_amount: amount,
    currency: 'usd',
    nickname: `${plan.code} — ${interval}`,
    lookup_key: key,
    recurring: { interval: interval === 'monthly' ? 'month' : 'year' },
    metadata: { plan_code: plan.code, billing_interval: interval },
  });
  console.log(`  price ${key}: created ${created.id}`);
  return created.id;
}

async function main(): Promise<void> {
  const secretKey = required('STRIPE_SECRET_KEY');
  const mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'test';

  const stripe = new Stripe(secretKey, {
    typescript: true,
    appInfo: { name: 'Georgia Opportunity Ledger setup', version: '0.1.0' },
  });

  console.log(`Stripe catalogue — ${mode} mode\n`);

  const supabase = createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  for (const plan of PLANS) {
    console.log(`${plan.code}:`);
    const product = await ensureProduct(stripe, plan);
    const monthly = await ensurePrice(stripe, product, plan, 'monthly');
    const annual = await ensurePrice(stripe, product, plan, 'annual');

    const { error } = await supabase
      .from('subscription_plans')
      .update({
        stripe_product_id: product.id,
        stripe_monthly_price_id: monthly,
        stripe_annual_price_id: annual,
      })
      .eq('code', plan.code);

    if (error) {
      console.error(`  database: FAILED — ${error.message}`);
      process.exitCode = 1;
    } else {
      console.log('  database: price ids written\n');
    }
  }

  console.log(
    `Done. Verify with a ${mode === 'LIVE' ? 'real card on a plan you can refund' : 'test card (4242 4242 4242 4242)'} ` +
      'at /pricing, then check the subscription row and the audit trail.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
