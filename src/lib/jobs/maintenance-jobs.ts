import { DELETION_GRACE_DAYS } from '@/lib/account/deletion';
import { createAdminClient } from '@/lib/db/admin';
import { runExportJob, type ExportJobRow } from '@/lib/exports/service';
import { cleanupExpiredExports } from '@/lib/exports/cleanup';
import {
  chooseSubscriptionToAdopt,
  subscriptionSearchQuery,
  type AdoptableSubscription,
} from '@/lib/billing/adopt-subscription';
import { planForPriceId } from '@/lib/billing/plans';
import { subscriptionPaymentState } from '@/lib/billing/payment-state';
import { stripe } from '@/lib/billing/stripe';
import { dailyKey, type JobDefinition } from '@/lib/jobs/runner';

/**
 * Maintenance and reconciliation jobs.
 *
 * The subscription-sync job exists because webhooks are best-effort: an
 * endpoint can be down when Stripe delivers, and Stripe eventually gives up.
 * Reconciling against Stripe's own state on a schedule means a missed webhook
 * costs a member a few hours of correct access rather than a support ticket.
 */

export const processExportsJob: JobDefinition = {
  name: 'process-exports',
  description: 'Generates queued CSV exports.',
  handler: async ({ note }) => {
    const supabase = createAdminClient();

    const { data: jobs, error } = await supabase
      .from('export_jobs')
      .select(
        'id, user_id, format, status, filter_configuration, saved_search_id, ' +
          'opportunity_ids, file_path',
      )
      .or(
        `status.eq.queued,and(status.eq.processing,lease_until.lt.${new Date().toISOString()}),and(status.eq.processing,lease_until.is.null)`,
      )
      .order('requested_at', { ascending: true })
      .limit(20);

    if (error) throw new Error(error.message);
    note('queued', jobs?.length ?? 0);

    let processed = 0;
    let failed = 0;

    const deadline = Date.now() + 25_000;
    for (const job of (jobs ?? []) as unknown as ExportJobRow[]) {
      if (Date.now() >= deadline) break;
      try {
        if (await runExportJob(job)) processed += 1;
      } catch (error) {
        failed += 1;
        console.error('[jobs] export failed', {
          id: job.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { processed, failed, detail: {} };
  },
};

export const syncSubscriptionsJob: JobDefinition = {
  name: 'sync-subscriptions',
  // It does not retry unprocessed webhook events, though it once said it did.
  // Reprocessing happens in the webhook route, on Stripe's own retry. What
  // this job contributes is the count of events still unprocessed, which is a
  // signal that something is failing repeatedly rather than a recovery of it.
  description:
    'Reconciles local subscription state, including the plan, against Stripe, ' +
    'and adopts subscriptions the webhook never reported.',
  handler: async ({ note }) => {
    const supabase = createAdminClient();

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      // One string literal, not a concatenation: the Supabase client derives
      // the row type from this literal, and splitting it across an expression
      // collapses the result to an untyped error shape.
      .select(
        'id, user_id, stripe_subscription_id, status, paid_through_at, updated_at, current_period_end, plan_id, billing_interval, cancel_at_period_end',
      )
      .not('stripe_subscription_id', 'is', null)
      .order('last_sync_attempt_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .limit(25);

    if (error) throw new Error(error.message);

    let corrected = 0;
    let failed = 0;

    const deadline = Date.now() + 28000;
    for (const record of subscriptions ?? []) {
      if (Date.now() >= deadline) break;
      if (!record.stripe_subscription_id) continue;
      try {
        const remote = await stripe().subscriptions.retrieve(
          record.stripe_subscription_id,
        );
        const payment = await subscriptionPaymentState(
          stripe(),
          remote,
          record.paid_through_at,
        );
        const status = payment.status;
        const remotePeriodEnd = payment.periodEnd;

        // The plan is reconciled too, not just the status. It previously was
        // not, which left the one piece of state that decides what a member
        // may read outside the safety net: an upgrade or downgrade whose
        // webhook failed kept the old `plan_id`, and therefore the old access
        // rank, permanently. Status recovered on the next sync; entitlement
        // never did.
        const priceId = ((
          remote.items.data[0]?.price as { id?: string } | undefined
        )?.id ?? null) as string | null;
        const plan = await planForPriceId(
          payment.paidPriceId ?? priceId,
          supabase,
        );

        const planChanged =
          plan !== null &&
          (plan.id !== record.plan_id ||
            plan.interval !== record.billing_interval);

        if (
          status !== record.status ||
          payment.paidThrough !== record.paid_through_at ||
          remotePeriodEnd !== record.current_period_end ||
          remote.cancel_at_period_end !== record.cancel_at_period_end ||
          planChanged
        ) {
          const { data: saved, error: updateError } = await supabase
            .from('subscriptions')
            .update({
              status,
              current_period_end: remotePeriodEnd,
              paid_through_at: payment.paidThrough,
              cancel_at_period_end: remote.cancel_at_period_end,
              // Only when the price resolved to a known plan. An unrecognised
              // price means the catalogue and the database disagree, and
              // guessing — most likely by falling back to free — would revoke
              // paid access over a bookkeeping mismatch.
              ...(plan
                ? { plan_id: plan.id, billing_interval: plan.interval }
                : {}),
            })
            .eq('id', record.id)
            .eq('updated_at', record.updated_at)
            .select('id')
            .maybeSingle();
          if (updateError) throw new Error(updateError.message);
          if (!saved)
            throw new Error(
              'Subscription changed concurrently; retry next reconciliation',
            );
          corrected += 1;
        }
      } catch (error) {
        failed += 1;
        console.error('[jobs] subscription sync failed', {
          id: record.id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        const { error: attemptError } = await supabase
          .from('subscriptions')
          .update({ last_sync_attempt_at: new Date().toISOString() })
          .eq('id', record.id);
        if (attemptError) throw new Error(attemptError.message);
      }
    }

    const { count: unprocessed, error: eventsError } = await supabase
      .from('billing_events')
      .select('id', { count: 'exact', head: true })
      .eq('processed', false);
    if (eventsError) throw new Error(eventsError.message);

    note('unprocessedWebhookEvents', unprocessed ?? 0);

    // Second pass: subscriptions the webhook never told us about.
    //
    // Everything above reconciles rows that already carry a
    // `stripe_subscription_id`, and only the webhook ever writes that column.
    // So the net caught changes to subscriptions it already knew and could not
    // discover one it had never heard of — the first purchase, which is where
    // it is needed most. On 2026-10-13 that was the difference between "late"
    // and "invisible": a real payment's events were refused on a signature
    // mismatch, Stripe treated the 400 as permanent and never retried, and
    // nothing downstream could find the subscription afterwards.
    const { data: unclaimed, error: unclaimedError } = await supabase
      .from('subscriptions')
      .select('id, user_id, updated_at')
      .is('stripe_subscription_id', null)
      .order('last_sync_attempt_at', { ascending: true, nullsFirst: true })
      .order('id', { ascending: true })
      .limit(25);
    if (unclaimedError) throw new Error(unclaimedError.message);

    let adopted = 0;
    let ambiguous = 0;
    let refused = 0;

    for (const record of unclaimed ?? []) {
      // Shares the reconcile pass's budget rather than opening a new one: the
      // whole handler has to finish inside the platform's function cap.
      if (Date.now() >= deadline) break;

      const query = subscriptionSearchQuery(record.user_id);
      if (!query) {
        // Counted, not just logged. Without this the row reads exactly like
        // "searched Stripe and found nothing eligible" in `detail` — two very
        // different facts behind one set of zeroes, and the job report is the
        // only place anybody looks after the hour of runtime logs has expired.
        refused += 1;
        console.error('[jobs] refusing to search for a non-UUID user id', {
          id: record.id,
        });
        continue;
      }

      try {
        const found = await stripe().subscriptions.search({ query, limit: 20 });
        const decision = chooseSubscriptionToAdopt(
          found.data as unknown as AdoptableSubscription[],
          record.user_id,
        );

        if (decision.ambiguous) {
          // Two adoptable subscriptions for one account is a billing fault in
          // its own right. The newest is taken so access is not withheld, but
          // it is said out loud rather than settled quietly by a reconciler.
          ambiguous += 1;
          console.error('[jobs] multiple adoptable subscriptions for account', {
            id: record.id,
            eligible: decision.eligible,
          });
        }

        if (!decision.chosen) continue;

        const remote = await stripe().subscriptions.retrieve(
          decision.chosen.id,
        );
        // The same resolver the reconcile pass uses, so adoption inherits the
        // settled-payment rule instead of deciding entitlement for itself.
        const payment = await subscriptionPaymentState(stripe(), remote, null);
        const priceId = ((
          remote.items.data[0]?.price as { id?: string } | undefined
        )?.id ?? null) as string | null;
        const plan = await planForPriceId(
          payment.paidPriceId ?? priceId,
          supabase,
        );

        if (!plan) {
          // Same policy as the reconcile pass: an unrecognised price must not
          // guess at a plan. The ids and status are still adopted, which
          // brings the row inside the net so a later run can finish once the
          // catalogue agrees.
          console.error('[jobs] adopting a subscription with no known plan', {
            id: record.id,
            priceId,
          });
        }

        const { data: saved, error: adoptError } = await supabase
          .from('subscriptions')
          .update({
            stripe_subscription_id: remote.id,
            stripe_customer_id:
              typeof remote.customer === 'string'
                ? remote.customer
                : remote.customer.id,
            status: payment.status,
            current_period_end: payment.periodEnd,
            paid_through_at: payment.paidThrough,
            cancel_at_period_end: remote.cancel_at_period_end,
            ...(plan
              ? { plan_id: plan.id, billing_interval: plan.interval }
              : {}),
          })
          .eq('id', record.id)
          .eq('updated_at', record.updated_at)
          // Belt as well as braces: a webhook landing between the read and
          // this write is the authoritative writer and must not be overwritten
          // by a slower reconciler.
          .is('stripe_subscription_id', null)
          .select('id')
          .maybeSingle();
        if (adoptError) throw new Error(adoptError.message);
        if (!saved) continue;

        adopted += 1;
        console.warn('[jobs] adopted a subscription the webhook missed', {
          id: record.id,
          subscription: remote.id,
          plan: plan?.id ?? null,
        });
      } catch (error) {
        failed += 1;
        console.error('[jobs] subscription adoption failed', {
          id: record.id,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        const { error: attemptError } = await supabase
          .from('subscriptions')
          .update({ last_sync_attempt_at: new Date().toISOString() })
          .eq('id', record.id);
        if (attemptError) throw new Error(attemptError.message);
      }
    }

    note('adoptedSubscriptions', adopted);

    return {
      processed: corrected + adopted,
      failed,
      detail: {
        checked: subscriptions?.length ?? 0,
        unclaimedChecked: unclaimed?.length ?? 0,
        adopted,
        ambiguous,
        refused,
        unprocessedWebhookEvents: unprocessed ?? 0,
      },
    };
  },
};

export const expireLapsedAccessJob: JobDefinition = {
  name: 'expire-lapsed-access',
  description:
    'Moves subscriptions past their grace window to expired so paid access ends.',
  idempotencyKey: dailyKey,
  handler: async ({ now }) => {
    const supabase = createAdminClient();

    // `canceled` past its period end, and `past_due` past the grace window,
    // both settle to `expired`. The access functions already treat them as
    // free; this makes the stored state match what members are told.
    const graceCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    const { data: canceled, error: cancelError } = await supabase
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('status', 'canceled')
      .or(
        `and(stripe_subscription_id.not.is.null,paid_through_at.lt.${now.toISOString()}),and(stripe_subscription_id.is.null,current_period_end.lt.${now.toISOString()})`,
      )
      .select('id');
    if (cancelError) throw new Error(cancelError.message);

    const { data: pastDue, error: pastDueError } = await supabase
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('status', 'past_due')
      .or(
        `and(stripe_subscription_id.not.is.null,paid_through_at.lt.${graceCutoff.toISOString()}),and(stripe_subscription_id.is.null,current_period_end.lt.${graceCutoff.toISOString()})`,
      )
      .select('id');
    if (pastDueError) throw new Error(pastDueError.message);

    return {
      processed: (canceled?.length ?? 0) + (pastDue?.length ?? 0),
      failed: 0,
      detail: {
        canceled: canceled?.length ?? 0,
        pastDueExhausted: pastDue?.length ?? 0,
      },
    };
  },
};

export const pruneJob: JobDefinition = {
  name: 'prune',
  description:
    'Removes spent rate-limit windows and expired export files, and purges ' +
    'accounts whose deletion grace window has passed.',
  idempotencyKey: dailyKey,
  handler: async ({ now, note }) => {
    const supabase = createAdminClient();

    const { data: pruned, error: pruneError } = await supabase.rpc(
      'prune_rate_limit_counters',
    );
    if (pruneError) throw new Error(pruneError.message);
    const exports = await cleanupExpiredExports(supabase, now);

    // Account deletion happens here rather than at the moment of the request:
    // it is irreversible, so a member has the whole grace window to change
    // their mind and a compromised session cannot destroy an account outright.
    //
    // Deleting the auth user is the entire operation. The cascade takes the
    // profile, preferences, saved records, saved searches, alert preferences,
    // notifications and the subscription cache; audit_logs, billing_events,
    // analytics_events, support_tickets and correction_requests are
    // `on delete set null` and survive de-identified, so the append-only audit
    // trail is not rewritten by somebody closing their account. Expressing
    // retention through the foreign keys rather than a list of tables to empty
    // is the only version that stays correct when a table is added later.
    const { data: due, error: dueError } = await supabase.rpc(
      'accounts_due_for_purge',
      { p_grace_days: DELETION_GRACE_DAYS },
    );
    if (dueError) throw new Error(dueError.message);

    let purged = 0;
    let purgeFailures = 0;

    for (const row of (due ?? []) as Array<{
      id: string;
      deletion_requested_at: string;
    }>) {
      try {
        // The candidate list can be stale. Claim this exact request under the
        // profile lock before calling Auth; a successful cancellation wins if
        // it got there first. Claims survive provider errors for safe retries.
        const { data: claimed, error: claimError } = await supabase.rpc(
          'claim_account_for_purge',
          { p_user_id: row.id, p_requested_at: row.deletion_requested_at },
        );
        if (claimError) throw new Error(claimError.message);
        if (claimed !== true) continue;

        const { error } = await supabase.auth.admin.deleteUser(row.id);
        if (error) throw new Error(error.message);
        purged += 1;
      } catch (error) {
        // One stuck account must not stop the rest, and it is retried
        // tomorrow. The count surfaces on the admin dashboard.
        console.error('[prune] account purge failed', {
          userId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
        purgeFailures += 1;
      }
    }

    note('accountsPurged', purged);

    return {
      processed: (Number(pruned ?? 0) || 0) + exports.expired + purged,
      failed: purgeFailures + exports.failed,
      detail: {
        rateLimitWindowsPruned: Number(pruned ?? 0) || 0,
        exportsExpired: exports.expired,
        exportCleanupFailures: exports.failed,
        accountsPurged: purged,
        accountPurgeFailures: purgeFailures,
      },
    };
  },
};

export const aggregateAnalyticsJob: JobDefinition = {
  name: 'aggregate-analytics',
  description: 'Summarises yesterday’s events for the admin dashboard.',
  idempotencyKey: dailyKey,
  handler: async ({ now }) => {
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const start = new Date(end.getTime() - 86400000);
    const { data, error } = await createAdminClient().rpc(
      'aggregate_analytics_window',
      {
        p_start: start.toISOString(),
        p_end: end.toISOString(),
      },
    );
    if (error) throw new Error(error.message);
    return {
      processed: Number(data?.total ?? 0),
      failed: 0,
      detail: {
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
        counts: data?.counts ?? {},
      },
    };
  },
};
