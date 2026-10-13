import { createAdminClient } from '@/lib/db/admin';
import { reportError } from '@/lib/observability/report-error';

/**
 * Background job runner (spec 17).
 *
 * Every job must be idempotent, logged, retryable and observable. This wrapper
 * provides all four:
 *
 *   - Idempotency: a job may declare a key for the window it covers. The unique
 *     index on `job_runs (job_name, idempotency_key)` means a second attempt in
 *     the same window is skipped rather than sending a second round of emails.
 *   - Logging and observability: every attempt writes a `job_runs` row that the
 *     admin dashboard reads, including the failure message.
 *   - Retryability: a failure is recorded, releases its window and is rethrown.
 *     The next invocation can retry; handlers must deduplicate individual work.
 */

export interface JobContext {
  now: Date;
  /** Durable pagination state; writes fail if this worker lost its lease. */
  state?: Record<string, unknown>;
  checkpoint?: (state: Record<string, unknown>) => Promise<void>;
  deadlineAt?: number;
  /** Records progress for the admin dashboard. */
  note: (key: string, value: unknown) => void;
}

export interface JobResult {
  processed: number;
  failed: number;
  detail: Record<string, unknown>;
  skipped?: boolean;
}

export type JobHandler = (context: JobContext) => Promise<JobResult>;

export interface JobDefinition {
  name: string;
  description: string;
  /**
   * Returns the idempotency key for the current run, or null for jobs that are
   * safe to run any number of times (their own writes are already conditional).
   */
  idempotencyKey?: (now: Date) => string | null;
  handler: JobHandler;
}

/** Day bucket, e.g. `2026-07-30` — for jobs that must run once per day. */
export function dailyKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** ISO week bucket, e.g. `2026-W31` — for the weekly distribution job. */
export function weeklyKey(now: Date): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  // ISO weeks start on Monday and are numbered from the week containing the
  // first Thursday of the year.
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export async function runJob(
  definition: JobDefinition,
  now: Date = new Date(),
): Promise<JobResult & { runId: string | null; skipped: boolean }> {
  const supabase = createAdminClient();
  const idempotencyKey = definition.idempotencyKey?.(now) ?? null;

  const { data: run, error: claimError } = await supabase.rpc('claim_job_run', {
    p_name: definition.name,
    p_key: idempotencyKey,
    p_now: now.toISOString(),
  });
  if (claimError)
    throw new Error(`Could not claim job run: ${claimError.message}`);
  if (!run?.id)
    return {
      runId: null,
      skipped: true,
      processed: 0,
      failed: 0,
      detail: { reason: 'already_running_or_completed', idempotencyKey },
    };

  const notes: Record<string, unknown> = {};
  const context: JobContext = {
    now,
    state: run.state ?? {},
    deadlineAt: Date.now() + 28_000,
    checkpoint: async (state) => {
      const { data, error } = await supabase.rpc('checkpoint_job_run', {
        p_id: run.id,
        p_state: state,
      });
      if (error || !data)
        throw new Error(
          `Could not checkpoint job: ${error?.message ?? 'worker lease lost'}`,
        );
      context.state = state;
    },
    note: (key, value) => {
      notes[key] = value;
    },
  };

  let result: JobResult | undefined;
  try {
    result = await definition.handler(context);
    if (result.failed > 0) {
      throw new Error(
        `${result.failed} record(s) failed in ${definition.name}`,
      );
    }
    const { data: finished, error: finishError } = await supabase.rpc(
      'finish_job_run',
      {
        p_id: run.id,
        p_result: {
          status: result.skipped ? 'skipped' : 'succeeded',
          records_processed: result.processed,
          records_failed: result.failed,
          detail: { ...notes, ...result.detail },
        },
      },
    );
    if (finishError || !finished)
      throw new Error(
        `Could not finish job run: ${finishError?.message ?? 'worker lease lost'}`,
      );

    return { ...result, runId: run.id, skipped: Boolean(result.skipped) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: recorded, error: failureLogError } = await supabase.rpc(
      'finish_job_run',
      {
        p_id: run.id,
        p_result: {
          status: 'failed',
          records_processed: result?.processed ?? 0,
          records_failed: result?.failed || 1,
          error_message: message,
          detail: { ...notes, ...result?.detail, retryWindow: idempotencyKey },
        },
      },
    );

    if (failureLogError || !recorded) {
      await reportError(
        new Error(
          `Could not record job failure: ${failureLogError?.message ?? 'worker lease lost'}`,
        ),
        {
          scope: 'job',
          tags: { job: definition.name },
        },
      );
    }

    await reportError(error, {
      scope: 'job',
      tags: { job: definition.name },
    });
    throw error;
  }
}
