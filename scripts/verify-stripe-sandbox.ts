/** Explicit, isolated Stripe sandbox rehearsal. Never run with a live key. */
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import { subscriptionPaymentState } from '../src/lib/billing/payment-state';
import { stripeCliFetch } from './stripe-cli-transport';

import { changeSubscriptionPlan } from '../src/lib/billing/plan-change';
import { stopSubscriptionForClosure } from '../src/lib/billing/close-account';
import { createMemberCheckout } from '../src/lib/billing/checkout';
import type { AdminSupabaseClient } from '../src/lib/db/admin';

async function main() {
  const cli = process.env.STRIPE_TEST_CLI;
  const config = process.env.STRIPE_TEST_CLI_CONFIG;
  const key =
    cli && config
      ? 'sk_test_cli_transport'
      : (process.env.STRIPE_SECRET_KEY ?? '');
  const expectedAccount = process.env.STRIPE_TEST_ACCOUNT_ID;
  assert(
    ['sk_test_', 'rk_test_', 'rkcs_test_'].some((prefix) =>
      key.startsWith(prefix),
    ),
    'A sandbox key is required',
  );
  assert(
    expectedAccount && expectedAccount !== 'acct_1UIWH6AhiRY2d5kX',
    'Use an isolated sandbox account',
  );
  const client = new Stripe(key, {
    apiVersion: '2026-09-30.endive',
    timeout: 15_000,
    ...(cli && config
      ? {
          httpClient: Stripe.createFetchHttpClient(stripeCliFetch(cli, config)),
        }
      : {}),
  });
  const account = await client.accounts.retrieveCurrent();
  assert.equal(account.id, expectedAccount);
  const clock = await client.testHelpers.testClocks.create({
    frozen_time: Math.floor(Date.now() / 1000),
    name: 'Ledger launch billing rehearsal',
  });
  const product = await client.products.create({
    name: 'Ledger sandbox rehearsal only',
  });
  assert.equal(product.livemode, false);
  const makePrice = (amount: number, interval: 'month' | 'year') =>
    client.prices.create({
      product: product.id,
      currency: 'usd',
      unit_amount: amount,
      recurring: { interval },
    });
  const weekly = await makePrice(1500, 'month');
  const premium = await makePrice(9900, 'month');
  const annual = await makePrice(15000, 'year');
  const clocks = [clock];
  const sessions: string[] = [];
  let memberCount = 0;
  let checks = 0;
  try {
    async function member(price: string) {
      if (memberCount++ === 3)
        clocks.push(
          await client.testHelpers.testClocks.create({
            frozen_time: clock.frozen_time,
            name: 'Ledger interval rehearsal',
          }),
        );
      const customer = await client.customers.create({
        test_clock: clocks[clocks.length - 1]!.id,
        name: 'Ledger sandbox test',
        metadata: { ledger_rehearsal: 'true' },
      });
      const payment = await client.paymentMethods.attach('pm_card_visa', {
        customer: customer.id,
      });
      await client.customers.update(customer.id, {
        invoice_settings: { default_payment_method: payment.id },
      });
      return client.subscriptions.create({
        customer: customer.id,
        items: [{ price }],
        payment_behavior: 'error_if_incomplete',
      });
    }
    const downgrade = await member(premium.id);
    const result = await changeSubscriptionPlan(
      client,
      downgrade,
      {
        priceId: weekly.id,
        planCode: 'weekly',
        interval: 'monthly',
        direction: 'downgrade',
      },
      `sandbox-${downgrade.id}`,
    );
    assert.equal(result.effective, 'end_of_period');
    assert.equal(
      (await client.subscriptions.retrieve(downgrade.id)).items.data[0]!.price
        .id,
      premium.id,
    );
    checks++;
    console.log('PASS: downgrade leaves current paid price intact');

    const upgrade = await member(weekly.id);
    const upgraded = await changeSubscriptionPlan(
      client,
      upgrade,
      {
        priceId: premium.id,
        planCode: 'premium',
        interval: 'monthly',
        direction: 'upgrade',
      },
      `sandbox-${upgrade.id}`,
    );
    assert.equal(upgraded.effective, 'immediately');
    assert.equal(
      (await client.subscriptions.retrieve(upgrade.id)).items.data[0]!.price.id,
      premium.id,
    );
    assert.equal(
      (
        await subscriptionPaymentState(
          client,
          await client.subscriptions.retrieve(upgrade.id),
        )
      ).status,
      'active',
    );
    checks++;
    console.log(
      'PASS: paid upgrade changes price immediately with settled access',
    );

    const declined = await member(weekly.id);
    const customerId =
      typeof declined.customer === 'string'
        ? declined.customer
        : declined.customer.id;
    const failingCard = await client.paymentMethods.attach(
      'pm_card_chargeCustomerFail',
      { customer: customerId },
    );
    await client.subscriptions.update(declined.id, {
      default_payment_method: failingCard.id,
    });
    const deferred = await changeSubscriptionPlan(
      client,
      await client.subscriptions.retrieve(declined.id),
      {
        priceId: premium.id,
        planCode: 'premium',
        interval: 'monthly',
        direction: 'upgrade',
      },
      `sandbox-${declined.id}`,
    );
    assert.equal(deferred.effective, 'payment_required');
    assert.equal(
      (await client.subscriptions.retrieve(declined.id)).items.data[0]!.price
        .id,
      weekly.id,
    );
    const declinedState = await subscriptionPaymentState(
      client,
      await client.subscriptions.retrieve(declined.id),
    );
    if (declinedState.status !== 'active') {
      const history = await client.invoices.list({
        subscription: declined.id,
        customer: customerId,
        status: 'paid',
        limit: 100,
      });
      console.log(
        JSON.stringify({
          diagnostic: 'declined upgrade payment evidence',
          state: declinedState,
          invoices: history.data.map((i) => ({
            status: i.status,
            lines: i.lines.data.map((l) => ({
              amount: l.amount,
              parent: l.parent,
              period: l.period,
            })),
          })),
        }),
      );
    }
    assert.equal(declinedState.status, 'active');
    checks++;
    console.log('PASS: declined upgrade retains the paid tier and access');

    const interval = await member(weekly.id);
    await changeSubscriptionPlan(
      client,
      interval,
      {
        priceId: annual.id,
        planCode: 'weekly',
        interval: 'annual',
        direction: 'same',
      },
      `sandbox-${interval.id}`,
    );
    assert.equal(
      (await client.subscriptions.retrieve(interval.id)).items.data[0]!.price
        .id,
      weekly.id,
    );
    checks++;
    console.log('PASS: interval change preserves the current period');

    const checkoutCustomer = await client.customers.create({
      test_clock: clocks[1]!.id,
    });
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                stripe_customer_id: checkoutCustomer.id,
                stripe_subscription_id: null,
              },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as AdminSupabaseClient;
    const checkoutInput = {
      userId: 'sandbox-member',
      priceId: weekly.id,
      planCode: 'weekly',
      siteUrl: 'https://example.test',
      operationId: `sandbox-${checkoutCustomer.id}`,
    };
    const checkout = await createMemberCheckout(client, db, checkoutInput);
    sessions.push(checkout.sessionId);
    assert.equal(
      (
        await createMemberCheckout(client, db, {
          ...checkoutInput,
          operationId: 'retry-same-price',
        })
      ).sessionId,
      checkout.sessionId,
    );
    const replacement = await createMemberCheckout(client, db, {
      ...checkoutInput,
      priceId: premium.id,
      planCode: 'premium',
      operationId: `replacement-${checkoutCustomer.id}`,
    });
    sessions.push(replacement.sessionId);
    assert.equal(
      (await client.checkout.sessions.retrieve(checkout.sessionId)).status,
      'expired',
    );
    assert.notEqual(replacement.sessionId, checkout.sessionId);
    assert.equal(
      (await client.checkout.sessions.retrieve(replacement.sessionId)).livemode,
      false,
    );
    checks++;
    console.log(
      'PASS: checkout retry reuses the open session and a different plan expires the old link',
    );

    for (const testClock of clocks) {
      await client.testHelpers.testClocks.advance(testClock.id, {
        frozen_time: downgrade.items.data[0]!.current_period_end + 60,
      });
      for (let attempt = 0; attempt < 45; attempt++) {
        const current = await client.testHelpers.testClocks.retrieve(
          testClock.id,
        );
        if (current.status === 'ready') break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      assert.equal(
        (await client.testHelpers.testClocks.retrieve(testClock.id)).status,
        'ready',
      );
    }
    assert.equal(
      (await client.subscriptions.retrieve(downgrade.id)).items.data[0]!.price
        .id,
      weekly.id,
    );
    assert.equal(
      (await client.subscriptions.retrieve(interval.id)).items.data[0]!.price
        .id,
      annual.id,
    );
    checks++;
    console.log('PASS: clock renewal applies the scheduled tier and interval');

    await stopSubscriptionForClosure(
      client,
      await client.subscriptions.retrieve(interval.id),
    );
    assert.equal(
      (await client.subscriptions.retrieve(interval.id)).status,
      'canceled',
    );
    await stopSubscriptionForClosure(
      client,
      await client.subscriptions.retrieve(upgrade.id),
    );
    assert.equal(
      (await client.subscriptions.retrieve(upgrade.id)).status,
      'canceled',
    );
    checks++;
    console.log(
      'PASS: account closure stops scheduled and ordinary subscriptions',
    );
    console.log(
      JSON.stringify({
        account: account.id,
        apiVersion: '2026-09-30.endive',
        checks,
        passed: true,
      }),
    );
  } finally {
    for (const id of sessions) {
      const session = await client.checkout.sessions.retrieve(id);
      if (session.status === 'open') await client.checkout.sessions.expire(id);
    }
    for (const testClock of clocks)
      await client.testHelpers.testClocks.del(testClock.id);
    for (const price of [weekly, premium, annual])
      await client.prices.update(price.id, { active: false });
    await client.products.update(product.id, { active: false });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
