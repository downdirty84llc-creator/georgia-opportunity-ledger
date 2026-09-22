/**
 * Creates the plan catalogue in Stripe and writes the price ids onto
 * `subscription_plans`.
 *
 * Run it once per environment:
 *
 *   npm run stripe:setup          # uses STRIPE_SECRET_KEY from the environment
 *
 * The mode is decided by the key you give it. A `sk_test_…` key builds the test
 * catalogue, a `sk_live_…` key builds the live one, and neither can see the
 * other — which is the point. There are no price ids committed to this
 * repository for exactly that reason: an id is only meaningful in the mode that
 * minted it, and hardcoding one guarantees that somebody eventually points a
 * live key at a test price.
 *
 * The key alone is not enough, though, because it says nothing about *which*
 * database receives the ids or *which* Stripe account minted them. Both have
 * gone wrong here before. So the script now refuses to run when the key's mode
 * and `NEXT_PUBLIC_ENVIRONMENT` disagree, and prints the resolved Stripe
 * account id and target database host before it writes anything.
 *
 * Idempotent. Products are matched on `metadata.plan_code`, prices on their
 * lookup key, so running it twice changes nothing. Prices are immutable in
 * Stripe, so if an amount here disagrees with an existing price the script
 * says so and does not silently create a duplicate — changing what an existing
 * subscriber pays is not something a setup script should do on its own.
 */

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

import { assertModeMatchesEnvironment, modeOf } from './stripe-mode';

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

/**
 * Stripe Tax product category: "Website Information Services - Business Use".
 *
 * Stripe defines it as an online service furnishing information to customers,
 * including online search and data comparison, where the customer uses a SaaS
 * program to reach the content — which is what a subscription to a searchable
 * database of published records is. Business use, because subscribers are
 * businesses researching commercial property and funding programmes; the
 * business/personal split only affects US sales, which is all of ours.
 *
 * Not left to the account default. That default is
 * `txcd_10000000`, "General - Electronically Supplied Services", whose own
 * description says to prefer a more specific category especially for US
 * sales — and on a shared account the default belongs to whichever business
 * set it, not to this one. Setting it per product keeps the determination with
 * the product it describes.
 *
 * Two neighbours were considered and rejected: `txcd_10701410` (information
 * delivered electronically *without* a SaaS program, which does not describe a
 * web application) and `txcd_10503005` (individual articles and newsletters
 * viewable by subscription, which describes a publication rather than a
 * searchable database). If an accountant disagrees, this is one constant and a
 * re-run of this script.
 */
const PRODUCT_TAX_CODE = 'txcd_10701400';

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
    // Reuse, but do not let a stale tax category ride along. Unlike a price,
    // a product is mutable and its tax code decides what is charged in every
    // US state where tax is collected — so "already exists" must not mean
    // "left as whatever it was", which for a product created before this
    // constant existed is the account-wide default.
    const currentTaxCode =
      typeof existing.tax_code === 'string'
        ? existing.tax_code
        : (existing.tax_code?.id ?? null);

    if (currentTaxCode !== PRODUCT_TAX_CODE) {
      await stripe.products.update(existing.id, {
        tax_code: PRODUCT_TAX_CODE,
      });
      console.log(
        `  product ${plan.code}: reusing ${existing.id}, tax code ` +
          `${currentTaxCode ?? 'unset'} -> ${PRODUCT_TAX_CODE}`,
      );
    } else {
      console.log(`  product ${plan.code}: reusing ${existing.id}`);
    }
    return existing;
  }

  const created = await stripe.products.create({
    name: plan.name,
    description: plan.description,
    tax_code: PRODUCT_TAX_CODE,
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
  const supabaseUrl = required('NEXT_PUBLIC_SUPABASE_URL');

  assertModeMatchesEnvironment(secretKey, process.env.NEXT_PUBLIC_ENVIRONMENT);
  const mode = modeOf(secretKey);

  const stripe = new Stripe(secretKey, {
    typescript: true,
    appInfo: { name: 'Georgia Opportunity Ledger setup', version: '0.1.0' },
  });

  // Name the account out loud before writing anything. "Which Stripe account"
  // is not visible in the key, and plan rows have already pointed at products
  // belonging to a different account than the one the keys opened — a failure
  // that looked fine in every listing until a real checkout said "No such
  // price". One line here makes the wrong account obvious before the write.
  const account = await stripe.accounts.retrieve();
  console.log(`Stripe catalogue — ${mode.toUpperCase()} mode`);
  console.log(
    `  account:  ${account.id}` +
      (account.settings?.dashboard?.display_name
        ? ` (${account.settings.dashboard.display_name})`
        : ''),
  );
  console.log(`  database: ${new URL(supabaseUrl).host}`);
  if (mode === 'live' && account.charges_enabled === false) {
    console.warn(
      '  WARNING: this account cannot accept charges yet. The catalogue will\n' +
        '  be created, but checkout stays broken until the account is activated.',
    );
  }
  console.log('');

  const supabase = createClient(
    supabaseUrl,
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
    `Done. Verify with a ${mode === 'live' ? 'real card on a plan you can refund' : 'test card (4242 4242 4242 4242)'} ` +
      'at /pricing, then check the subscription row and the audit trail.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
