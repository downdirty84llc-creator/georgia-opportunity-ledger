import { createAdminClient } from '@/lib/db/admin';
import { publicEnv, serverEnv } from '@/lib/env';
import {
  opportunityExportColumns,
  toCsv,
  type ExportableOpportunity,
} from '@/lib/exports/csv';

/**
 * Export generation.
 *
 * Runs identically whether it is called inline for a small export or by the
 * background worker for a large one, so there is one code path to reason about
 * and one place where the row cap lives.
 */

/** Hard ceiling on a single export, regardless of plan. */
export const MAX_EXPORT_ROWS = 5000;

export interface ExportJobRow {
  id: string;
  user_id: string;
  format: string;
  status: string;
  filter_configuration: unknown;
  saved_search_id: string | null;
  opportunity_ids: string[] | null;
  file_path: string | null;
}

interface ClaimedExport extends ExportJobRow {
  lease_token: string;
  prepared_csv: string | null;
  row_count: number | null;
  attempts: number;
  truncated: boolean;
}

export async function runExportJob(
  job: ExportJobRow,
): Promise<{ rowCount: number; filePath: string; truncated: boolean } | null> {
  const admin = createAdminClient();
  const env = serverEnv();
  const { data, error: claimError } = await admin.rpc('claim_export_job', {
    p_id: job.id,
  });
  if (claimError)
    throw new Error(`Could not claim export: ${claimError.message}`);
  const claimed = data as ClaimedExport | null;
  if (!claimed?.id) return null;
  const token = claimed.lease_token;

  try {
    let csv = claimed.prepared_csv;
    let rowCount = claimed.row_count ?? 0;
    let truncated = claimed.truncated;
    if (csv === null) {
      // One SQL snapshot returns one JSON object, so PostgREST's row-page limit
      // cannot silently truncate a 5,000-row CSV to 1,000 rows.
      const { data: snapshot, error } = await admin.rpc(
        'export_opportunity_data',
        { p_id: job.id, p_token: token },
      );
      if (error) throw new Error(`Export query failed: ${error.message}`);
      if (!snapshot || !Array.isArray(snapshot.rows))
        throw new Error('Export snapshot was not returned.');
      const rows = snapshot.rows as ExportableOpportunity[];
      csv = toCsv(rows, opportunityExportColumns(publicEnv.siteUrl));
      rowCount = rows.length;
      truncated = Boolean(snapshot.truncated);
      const { data: prepared, error: prepareError } = await admin
        .from('export_jobs')
        .update({
          prepared_csv: csv,
          row_count: rowCount,
          truncated,
          prepared_access_rank: snapshot.accessRank,
        })
        .eq('id', job.id)
        .eq('lease_token', token)
        .eq('status', 'processing')
        .is('prepared_csv', null)
        .select('id')
        .maybeSingle();
      if (prepareError || !prepared)
        throw new Error(
          `Could not persist export snapshot: ${prepareError?.message ?? 'claim lost'}`,
        );
    }
    const filePath = claimed.file_path;
    if (!filePath) throw new Error('Export claim has no file path.');
    // Prepared bytes are immutable across retries. Upsert recovers a provider
    // success whose response was lost; a reclaimed worker uploads identical bytes.
    const { error: uploadError } = await admin.storage
      .from(env.storageBuckets.exports)
      .upload(filePath, new Blob([csv], { type: 'text/csv' }), {
        contentType: 'text/csv',
        upsert: true,
      });
    if (uploadError)
      throw new Error(`Export upload failed: ${uploadError.message}`);
    const { data: finished, error: finishError } = await admin.rpc(
      'finish_export_job',
      { p_id: job.id, p_token: token },
    );
    if (finishError || !finished)
      throw new Error(
        `Could not complete export: ${finishError?.message ?? 'claim expired or access changed'}`,
      );
    return { rowCount, filePath, truncated };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { error: failureError } = await admin
      .from('export_jobs')
      .update({
        status: claimed.attempts >= 5 ? 'failed' : 'queued',
        lease_until: null,
        error_message: message,
      })
      .eq('id', job.id)
      .eq('lease_token', token)
      .eq('status', 'processing');
    if (failureError)
      throw new Error(
        `${message}; retry state could not be saved: ${failureError.message}`,
      );
    throw error;
  }
}

/** Signed URLs are short-lived; the member re-requests one per download. */
export const SIGNED_URL_TTL_SECONDS = 300;

export async function signExportDownload(
  filePath: string,
): Promise<string | null> {
  const admin = createAdminClient();
  const env = serverEnv();
  const { data, error } = await admin.storage
    .from(env.storageBuckets.exports)
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error('[exports] could not sign download', error.message);
    return null;
  }
  return data?.signedUrl ?? null;
}
