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
  handler: async (context) => {
    if (!context.checkpoint)
      throw new Error('Deadline processing requires durable checkpoints.');
    const { now, note, checkpoint } = context;
    const client = createAdminClient();
    const deadline = context.deadlineAt ?? Date.now() + 25_000;
    let after =
      typeof context.state?.after === 'string'
        ? context.state.after
        : undefined;
    let processed = 0;
    const transitions: Record<string, number> = {};
    while (Date.now() < deadline - 5000) {
      let query = client
        .from('opportunities')
        .select(
          'id,status,closing_date,opening_date,is_expired,is_closing_soon,updated_at',
        )
        .eq('workflow_status', 'published')
        .order('id')
        .limit(50);
      if (after) query = query.gt('id', after);
      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);
      for (const row of rows ?? []) {
        if (Date.now() >= deadline - 5000) {
          await checkpoint({ after });
          return { processed, failed: 0, detail: { transitions, more: true } };
        }
        const next = evaluateLifecycle(
          {
            closingDate: row.closing_date ? new Date(row.closing_date) : null,
            openingDate: row.opening_date ? new Date(row.opening_date) : null,
            status: row.status as OpportunityStatus,
          },
          now,
        );
        if (
          next.isExpired !== row.is_expired ||
          next.isClosingSoon !== row.is_closing_soon ||
          next.status !== row.status
        ) {
          const { data: changed, error: updateError } = await client
            .from('opportunities')
            .update({
              is_expired: next.isExpired,
              is_closing_soon: next.isClosingSoon,
              status: next.status,
              workflow_status: next.isExpired ? 'expired' : undefined,
            })
            .eq('id', row.id)
            .eq('updated_at', row.updated_at)
            .eq('workflow_status', 'published')
            .select('id');
          if (updateError) throw new Error(updateError.message);
          if (changed?.length) {
            processed++;
            const key = `${row.status}->${next.status}`;
            transitions[key] = (transitions[key] ?? 0) + 1;
          }
        }
        after = row.id;
      }
      if ((rows?.length ?? 0) < 50) {
        await checkpoint({});
        note('transitions', transitions);
        return {
          processed,
          failed: 0,
          detail: { transitions, cycleComplete: true },
        };
      }
      await checkpoint({ after });
    }
    return { processed, failed: 0, detail: { transitions, more: true } };
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
