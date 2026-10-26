import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/db/admin';
import { serverEnv } from '@/lib/env';
import {
  BouncerError,
  createBouncerScan,
  pollBouncerScan,
  uploadBouncerFile,
} from '@/lib/files/bouncer';
import type { JobContext, JobResult } from '@/lib/jobs/runner';

export interface BouncerTask {
  attachment_id: string;
  file_path: string;
  checksum: string;
  file_size: number;
  phase: 'ready' | 'requesting' | 'polling' | 'quarantined';
  provider_scan_id: string | null;
  created_at: string;
}
type Action = 'retry' | 'pending' | 'clean' | 'infected' | 'failed' | 'removed';
export interface BouncerStore {
  download: (signal: AbortSignal) => Promise<Uint8Array>;
  begin: () => Promise<void>;
  checkpoint: (id: string) => Promise<void>;
  finish: (verdict: Action, detail: string | null) => Promise<void>;
  remove: () => Promise<void>;
}

/** One bounded worker turn. Provider IDs survive upload/poll/process failures. */
export async function processBouncerTask(
  task: BouncerTask,
  store: BouncerStore,
  key: string,
  signal: AbortSignal,
): Promise<'pending' | 'clean' | 'infected' | 'failed'> {
  let phase = task.phase;
  let id = task.provider_scan_id;
  const file = { size: Number(task.file_size), sha256: task.checksum };
  if (phase === 'quarantined') {
    await store.remove();
    await store.finish('removed', null);
    return 'infected';
  }
  // No idempotency key is documented for create. An uncertain create must not
  // spend another credit or lose track of a file the provider may have received.
  if (phase === 'requesting') {
    await store.finish(
      'failed',
      'Previous scanner submission has an uncertain outcome; operator review is required before another submission.',
    );
    return 'failed';
  }
  if (Date.now() - Date.parse(task.created_at) > 25 * 60 * 60_000) {
    await store.finish(
      'failed',
      'Scanner task exceeded its recovery window; operator review is required.',
    );
    return 'failed';
  }
  try {
    if (phase === 'ready') {
      const bytes = await store.download(signal);
      if (
        bytes.length !== file.size ||
        createHash('sha256').update(bytes).digest('hex') !== file.sha256
      ) {
        await store.finish(
          'failed',
          'Stored file does not match its accepted size and checksum; no file was sent.',
        );
        return 'failed';
      }
      signal.throwIfAborted();
      await store.begin();
      phase = 'requesting';
      const ticket = await createBouncerScan(key, file, signal);
      // Persist the ID before sending bytes. Never persist the upload ticket.
      await store.checkpoint(ticket.id);
      id = ticket.id;
      phase = 'polling';
      await uploadBouncerFile(ticket, bytes, signal);
    }
    if (!id) throw new BouncerError('invalid');
    const result = await pollBouncerScan(key, id, file, signal);
    await store.finish(result.verdict, result.detail);
    if (result.verdict === 'infected') {
      // Persist quarantine first. Failed removal is retried without re-scanning.
      phase = 'quarantined';
      await store.remove();
      await store.finish('removed', null);
    }
    return result.verdict;
  } catch (error) {
    if (phase === 'quarantined')
      throw new Error(
        'Attachment is quarantined; object removal requires retry.',
      );
    const detail =
      error instanceof BouncerError
        ? error.message
        : 'Scanner operation could not complete; the attachment remains blocked.';
    if (phase === 'ready') {
      await store.finish('retry', detail);
      return 'failed';
    }
    if (
      phase === 'polling' &&
      !(
        error instanceof BouncerError &&
        ['missing', 'invalid', 'auth', 'quota'].includes(error.code)
      )
    ) {
      await store.finish('pending', detail);
      return 'pending';
    }
    await store.finish('failed', detail);
    return 'failed';
  }
}

export async function scanBouncerAttachments(
  context: JobContext,
): Promise<JobResult> {
  const key = process.env.BOUNCER_API_KEY ?? '';
  if (!/^bnc_live_[A-Za-z0-9_-]+$/.test(key))
    throw new Error(
      'Bouncer is selected but its API key is missing or invalid.',
    );
  const admin = createAdminClient();
  const bucket = admin.storage.from(serverEnv().storageBuckets.attachments);
  const deadline = Math.min(
    context.deadlineAt ?? Infinity,
    Date.now() + 25_000,
  );
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const { data, error } = await admin
      .rpc(name, args)
      .abortSignal(
        AbortSignal.timeout(Math.max(1, Math.min(3000, deadline - Date.now()))),
      );
    if (error)
      throw new Error('Could not persist attachment scanner progress.');
    return data;
  };
  const rows = (await rpc('pending_attachment_scans', {})) as Array<{
    attachment_id: string;
  }>;
  context.note('queued', rows.length);
  let processed = 0,
    failed = 0,
    pending = 0,
    infected = 0;
  for (const row of rows) {
    if (Date.now() + 5000 >= deadline) break;
    const lease = crypto.randomUUID();
    const task = (await rpc('claim_attachment_scan', {
      p_id: row.attachment_id,
      p_lease: lease,
    })) as BouncerTask | null;
    if (!task) continue;
    const write = async (name: string, args: Record<string, unknown>) => {
      if (
        !(await rpc(name, {
          p_id: task.attachment_id,
          p_lease: lease,
          ...args,
        }))
      )
        throw new Error('Attachment scanner lease was lost.');
    };
    try {
      const result = await processBouncerTask(
        task,
        {
          download: async (signal) => {
            const { data, error } = await bucket.download(
              task.file_path,
              {},
              { signal },
            );
            if (
              error ||
              !data ||
              data.size !== Number(task.file_size) ||
              data.size > 26_214_400
            )
              throw new Error('Stored attachment is unavailable.');
            return new Uint8Array(await data.arrayBuffer());
          },
          begin: () => write('begin_attachment_scan', {}),
          checkpoint: (id) =>
            write('checkpoint_attachment_scan', { p_scan_id: id }),
          finish: (verdict, detail) =>
            write('finish_attachment_scan', {
              p_verdict: verdict,
              p_detail: detail,
            }),
          remove: async () => {
            const { error } = await bucket.remove([task.file_path]);
            if (error) throw new Error('Quarantined object removal failed.');
          },
        },
        key,
        AbortSignal.timeout(
          Math.max(1, Math.min(20_000, deadline - Date.now() - 3000)),
        ),
      );
      if (result === 'pending') pending++;
      else if (result === 'failed') failed++;
      else {
        processed++;
        if (result === 'infected') infected++;
      }
    } catch {
      failed++;
      console.error('[jobs] attachment scanner progress needs retry', {
        id: task.attachment_id,
      });
    }
  }
  const { count: review, error } = await admin
    .from('attachment_scan_jobs')
    .select('attachment_id', { count: 'exact', head: true })
    .eq('phase', 'review');
  if (error)
    throw new Error('Could not check attachment scanner review queue.');
  return {
    processed,
    failed,
    detail: { pending, infected, review: review ?? 0 },
  };
}
