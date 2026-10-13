import type { createAdminClient } from '@/lib/db/admin';
import { serverEnv } from '@/lib/env';

/** Keep the reference until Storage confirms deletion, so failures can retry. */
export async function cleanupExpiredExports(
  supabase: ReturnType<typeof createAdminClient>,
  now: Date,
): Promise<{ expired: number; failed: number }> {
  const { data: jobs, error } = await supabase
    .from('export_jobs')
    .select('id, file_path')
    .lt('expires_at', now.toISOString())
    .or('status.neq.expired,file_path.not.is.null,prepared_csv.not.is.null')
    .order('expires_at', { ascending: true })
    .limit(100);
  if (error)
    throw new Error(`Could not list expired exports: ${error.message}`);

  let expired = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    try {
      if (job.file_path) {
        const { error: storageError } = await supabase.storage
          .from(serverEnv().storageBuckets.exports)
          .remove([job.file_path]);
        if (storageError) throw new Error(storageError.message);
      }
      const { error: updateError } = await supabase
        .from('export_jobs')
        .update({ status: 'expired', file_path: null, prepared_csv: null })
        .eq('id', job.id);
      if (updateError) throw new Error(updateError.message);
      expired += 1;
    } catch (error) {
      failed += 1;
      console.error('[prune] export cleanup failed', {
        id: job.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { expired, failed };
}
