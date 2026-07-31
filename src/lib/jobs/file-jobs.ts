import { createAdminClient } from '@/lib/db/admin';
import { serverEnv } from '@/lib/env';
import { scanAndRecord } from '@/lib/files/attachments';
import type { JobDefinition } from '@/lib/jobs/runner';

/**
 * Attachment scanning follow-up (spec 17, 20).
 *
 * Uploads scan inline, so in the ordinary case this job finds nothing. It
 * exists for the cases where inline scanning did not finish:
 *
 *   - the scanner was down or slow, and the verdict came back `failed`;
 *   - the function was killed between storing the file and recording a
 *     verdict, leaving the row `pending` or stuck in `scanning`;
 *   - files uploaded before scanning existed, which migration 0022 reset to
 *     `pending` precisely so this job would pick them up.
 *
 * All three states are invisible to members until resolved, so the job is
 * clearing a backlog of hidden files rather than closing an exposure.
 */

/** How many attempts before a file is left alone for a human to look at. */
const MAX_ATTEMPTS = 5;

/** A row stuck in `scanning` for longer than this had its process killed. */
const STUCK_SCAN_MINUTES = 15;

interface PendingRow {
  id: string;
  file_path: string;
  file_name: string;
  scan_status: string;
  scan_attempts: number;
}

export const scanAttachmentsJob: JobDefinition = {
  name: 'scan-attachments',
  description: 'Rescans attachments whose scan did not complete.',
  handler: async ({ note, now }) => {
    const env = serverEnv();
    const supabase = createAdminClient();

    const stuckBefore = new Date(
      now.getTime() - STUCK_SCAN_MINUTES * 60_000,
    ).toISOString();

    // `scanning` rows are only claimed once they are demonstrably stale, so a
    // scan that is legitimately in flight is not restarted underneath itself.
    const { data: rows, error } = await supabase
      .from('attachments')
      .select('id, file_path, file_name, scan_status, scan_attempts')
      .in('scan_status', ['pending', 'failed', 'scanning'])
      .lt('scan_attempts', MAX_ATTEMPTS)
      .or(`scan_status.neq.scanning,updated_at.lt.${stuckBefore}`)
      .order('uploaded_at', { ascending: true })
      .limit(25);

    if (error) throw new Error(error.message);

    const pending = (rows ?? []) as unknown as PendingRow[];
    note('queued', pending.length);

    let processed = 0;
    let failed = 0;
    let infected = 0;

    for (const row of pending) {
      try {
        const { data: blob, error: downloadError } = await supabase.storage
          .from(env.storageBuckets.attachments)
          .download(row.file_path);

        if (downloadError || !blob) {
          // The object is gone but the row survives. That is what an infected
          // file looks like after quarantine, and what a manual deletion from
          // the bucket looks like too. Either way there is nothing to scan.
          await supabase
            .from('attachments')
            .update({
              scan_status: 'failed',
              scan_detail:
                'The stored object is missing, so it could not be scanned.',
              scan_attempts: row.scan_attempts + 1,
              scanned_at: now.toISOString(),
            })
            .eq('id', row.id);
          failed += 1;
          continue;
        }

        await supabase
          .from('attachments')
          .update({ scan_attempts: row.scan_attempts + 1 })
          .eq('id', row.id);

        const bytes = new Uint8Array(await blob.arrayBuffer());
        const outcome = await scanAndRecord(
          row.id,
          row.file_path,
          row.file_name,
          bytes,
        );

        if (outcome.verdict === 'infected') infected += 1;
        else if (outcome.verdict === 'failed') failed += 1;
        else processed += 1;
      } catch (error) {
        failed += 1;
        console.error('[jobs] attachment rescan failed', {
          id: row.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Anything that has exhausted its attempts needs a person, not another
    // retry. Surfacing the count here puts it on the admin dashboard.
    const { count: exhausted } = await supabase
      .from('attachments')
      .select('id', { count: 'exact', head: true })
      .in('scan_status', ['pending', 'failed', 'scanning'])
      .gte('scan_attempts', MAX_ATTEMPTS);

    return {
      processed,
      failed,
      detail: { infected, exhausted: exhausted ?? 0 },
    };
  },
};
