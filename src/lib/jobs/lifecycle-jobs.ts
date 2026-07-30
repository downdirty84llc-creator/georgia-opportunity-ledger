import { createAdminClient } from '@/lib/db/admin';
import {
  evaluateLifecycle,
  REVERIFICATION_DAYS,
  type OpportunityStatus,
} from '@/lib/opportunities/lifecycle';
import type { JobDefinition } from '@/lib/jobs/runner';
import { dailyKey } from '@/lib/jobs/runner';

/**
 * Jobs that exist because time passes.
 *
 * Nothing writes to an opportunity on the day its deadline lapses, so the
 * derived flags would stay stale without a sweep. Each of these is safe to run
 * repeatedly — they compare current state to derived state and write only the
 * difference.
 */

export const evaluateDeadlinesJob: JobDefinition = {
  name: 'evaluate-deadlines',
  description:
    'Recomputes expiry and closing-soon flags across published records.',
  // No idempotency key: the job compares derived state to stored state and
  // writes only differences, so running it twice in a window is a no-op.
  handler: async ({ now, note }) => {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('opportunities')
      .select('id, status, closing_date, opening_date, is_expired, is_closing_soon')
      .eq('workflow_status', 'published')
      .not('closing_date', 'is', null);

    if (error) throw new Error(error.message);

    let processed = 0;
    let failed = 0;
    const transitions: Record<string, number> = {};

    for (const row of data ?? []) {
      const next = evaluateLifecycle(
        {
          closingDate: row.closing_date ? new Date(row.closing_date) : null,
          openingDate: row.opening_date ? new Date(row.opening_date) : null,
          status: row.status as OpportunityStatus,
        },
        now,
      );

      const changed =
        next.isExpired !== row.is_expired ||
        next.isClosingSoon !== row.is_closing_soon ||
        next.status !== row.status;

      if (!changed) continue;

      const { error: updateError } = await supabase
        .from('opportunities')
        .update({
          is_expired: next.isExpired,
          is_closing_soon: next.isClosingSoon,
          status: next.status,
          // A record whose deadline has passed leaves the published workflow
          // state so it stops appearing in default searches, but stays readable
          // at its permalink for anyone who bookmarked it.
          workflow_status: next.isExpired ? 'expired' : undefined,
        })
        .eq('id', row.id);

      if (updateError) {
        failed += 1;
        console.error('[jobs] deadline update failed', {
          id: row.id,
          message: updateError.message,
        });
        continue;
      }

      processed += 1;
      const key = `${row.status}->${next.status}`;
      transitions[key] = (transitions[key] ?? 0) + 1;
    }

    note('transitions', transitions);
    return { processed, failed, detail: { transitions } };
  },
};

export const publishScheduledJob: JobDefinition = {
  name: 'publish-scheduled',
  description: 'Publishes records whose scheduled time has arrived.',
  handler: async ({ now }) => {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('opportunities')
      .update({
        workflow_status: 'published',
        published_at: now.toISOString(),
      })
      .eq('workflow_status', 'scheduled')
      .lte('scheduled_at', now.toISOString())
      .select('id');

    if (error) throw new Error(error.message);

    const { data: reports, error: reportError } = await supabase
      .from('reports')
      .update({ status: 'published', published_at: now.toISOString() })
      .eq('status', 'scheduled')
      .lte('scheduled_at', now.toISOString())
      .select('id');

    if (reportError) throw new Error(reportError.message);

    return {
      processed: (data?.length ?? 0) + (reports?.length ?? 0),
      failed: 0,
      detail: {
        opportunities: data?.length ?? 0,
        reports: reports?.length ?? 0,
      },
    };
  },
};

export const reverificationRemindersJob: JobDefinition = {
  name: 'reverification-reminders',
  description:
    'Flags published records whose verification is older than the review interval.',
  idempotencyKey: dailyKey,
  handler: async ({ now }) => {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('opportunities')
      .update({ verification_status: 'reverification_due' })
      .eq('workflow_status', 'published')
      .eq('verification_status', 'verified')
      .lte('reverification_due_at', now.toISOString())
      .select('id, title');

    if (error) throw new Error(error.message);

    return {
      processed: data?.length ?? 0,
      failed: 0,
      detail: {
        intervalDays: REVERIFICATION_DAYS,
        flagged: (data ?? []).slice(0, 25).map((row) => row.title),
      },
    };
  },
};

export const staleSourceRemindersJob: JobDefinition = {
  name: 'stale-source-reminders',
  description: 'Lists active sources that are overdue for a check.',
  idempotencyKey: dailyKey,
  handler: async ({ now }) => {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from('sources')
      .select('id, name, last_checked_at, next_check_at')
      .eq('is_active', true)
      .or(`next_check_at.lte.${now.toISOString()},next_check_at.is.null`)
      .limit(200);

    if (error) throw new Error(error.message);

    return {
      processed: data?.length ?? 0,
      failed: 0,
      detail: {
        overdue: (data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          lastCheckedAt: row.last_checked_at,
        })),
      },
    };
  },
};
