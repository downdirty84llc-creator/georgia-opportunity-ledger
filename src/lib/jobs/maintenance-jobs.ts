import { createAdminClient } from '@/lib/db/admin';
import { runExportJob, type ExportJobRow } from '@/lib/exports/service';
import { fromStripeStatus } from '@/lib/billing/subscription';
import { stripe, toDate } from '@/lib/billing/stripe';
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
      .eq('status', 'queued')
      .order('requested_at', { ascending: true })
      .limit(20);

    if (error) throw new Error(error.message);
    note('queued', jobs?.length ?? 0);

    let processed = 0;
    let failed = 0;

    for (const job of (jobs ?? []) as unknown as ExportJobRow[]) {
      try {
        // The worker has no member session, so row-level security cannot scope
        // the query for it. It resolves the member's rank through the same
        // database function the API uses and passes it as an explicit cap.
        const client = createAdminClient();
        const { data: rank } = await client.rpc('effective_access_rank', {
          target_user: job.user_id,
        });

        await runExportJob(job, client, Number(rank ?? 0));
        processed += 1;
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
  description:
    'Reconciles local subscription state against Stripe and retries unprocessed webhooks.',
  handler: async ({ note }) => {
    const supabase = createAdminClient();

    const { data: subscriptions, error } = await supabase
      .from('subscriptions')
      .select('id, user_id, stripe_subscription_id, status, current_period_end')
      .not('stripe_subscription_id', 'is', null)
      .limit(500);

    if (error) throw new Error(error.message);

    let corrected = 0;
    let failed = 0;

    for (const record of subscriptions ?? []) {
      if (!record.stripe_subscription_id) continue;
      try {
        const remote = await stripe().subscriptions.retrieve(
          record.stripe_subscription_id,
        );
        const status = fromStripeStatus(remote.status);

        const item = remote.items.data[0] as unknown as
          | Record<string, unknown>
          | undefined;
        const periodEnd =
          (item?.current_period_end as number | undefined) ??
          ((remote as unknown as Record<string, unknown>).current_period_end as
            | number
            | undefined) ??
          null;
        const remotePeriodEnd = toDate(periodEnd)?.toISOString() ?? null;

        if (
          status !== record.status ||
          remotePeriodEnd !== record.current_period_end
        ) {
          await supabase
            .from('subscriptions')
            .update({
              status,
              current_period_end: remotePeriodEnd,
              cancel_at_period_end: remote.cancel_at_period_end,
            })
            .eq('id', record.id);
          corrected += 1;
        }
      } catch (error) {
        failed += 1;
        console.error('[jobs] subscription sync failed', {
          id: record.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const { count: unprocessed } = await supabase
      .from('billing_events')
      .select('id', { count: 'exact', head: true })
      .eq('processed', false);

    note('unprocessedWebhookEvents', unprocessed ?? 0);

    return {
      processed: corrected,
      failed,
      detail: {
        checked: subscriptions?.length ?? 0,
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
      .lt('current_period_end', now.toISOString())
      .select('id');
    if (cancelError) throw new Error(cancelError.message);

    const { data: pastDue, error: pastDueError } = await supabase
      .from('subscriptions')
      .update({ status: 'expired' })
      .eq('status', 'past_due')
      .lt('current_period_end', graceCutoff.toISOString())
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
  description: 'Removes spent rate-limit windows and expired export files.',
  idempotencyKey: dailyKey,
  handler: async ({ now }) => {
    const supabase = createAdminClient();

    const { data: pruned } = await supabase.rpc('prune_rate_limit_counters');

    const { data: expired } = await supabase
      .from('export_jobs')
      .update({ status: 'expired', file_path: null })
      .eq('status', 'ready')
      .lt('expires_at', now.toISOString())
      .select('id, file_path');

    return {
      processed: (Number(pruned ?? 0) || 0) + (expired?.length ?? 0),
      failed: 0,
      detail: {
        rateLimitWindowsPruned: Number(pruned ?? 0) || 0,
        exportsExpired: expired?.length ?? 0,
      },
    };
  },
};

export const aggregateAnalyticsJob: JobDefinition = {
  name: 'aggregate-analytics',
  description: 'Summarises yesterday’s events for the admin dashboard.',
  idempotencyKey: dailyKey,
  handler: async ({ now }) => {
    const supabase = createAdminClient();
    const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from('analytics_events')
      .select('event_name')
      .gte('occurred_at', start.toISOString())
      .limit(20000);

    if (error) throw new Error(error.message);

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      counts[row.event_name] = (counts[row.event_name] ?? 0) + 1;
    }

    return {
      processed: data?.length ?? 0,
      failed: 0,
      detail: { windowStart: start.toISOString(), counts },
    };
  },
};
