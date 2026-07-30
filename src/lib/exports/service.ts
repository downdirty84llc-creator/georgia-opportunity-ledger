import type { SupabaseClient } from '@supabase/supabase-js';

import { createAdminClient } from '@/lib/db/admin';
import { publicEnv, serverEnv } from '@/lib/env';
import {
  exportFileName,
  opportunityExportColumns,
  toCsv,
  type ExportableOpportunity,
} from '@/lib/exports/csv';
import { parseStoredFilters } from '@/lib/search/filters';

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

/**
 * Loads the rows an export covers.
 *
 * An export must contain exactly the records the member could have opened in
 * the browser, and nothing else. Two independent guards enforce that:
 *
 *   - When called from a request, `supabase` is the member's own RLS-scoped
 *     client, so the database refuses anything above their rank.
 *   - The background worker has no member session to borrow, so it passes the
 *     member's resolved rank explicitly and the filter is applied here.
 *
 * The rank filter is applied in both paths. Belt and braces is cheap; a CSV
 * containing paid records a free account exported is not.
 */
async function collectRows(
  supabase: SupabaseClient,
  job: ExportJobRow,
  maxAccessRank: number,
): Promise<ExportableOpportunity[]> {
  const selection = `
    title, slug, category, subtype, status, score, score_classification,
    summary, street_address, estimated_value_min, estimated_value_max,
    capital_required_min, capital_required_max, closing_date, date_verified,
    verification_status, original_source_url, recommended_next_action,
    is_sample, counties ( name ), cities ( name )
  `;

  let query = supabase
    .from('opportunities')
    .select(selection)
    .eq('workflow_status', 'published')
    .eq('is_restricted', false)
    .lte('minimum_access_rank', maxAccessRank)
    .limit(MAX_EXPORT_ROWS);

  if (job.opportunity_ids && job.opportunity_ids.length > 0) {
    query = query.in('id', job.opportunity_ids);
  } else {
    const filters = parseStoredFilters(job.filter_configuration);
    if (filters.category?.length) query = query.in('category', filters.category);
    if (filters.status?.length) query = query.in('status', filters.status);
    if (filters.countyIds?.length) query = query.in('county_id', filters.countyIds);
    if (filters.cityIds?.length) query = query.in('city_id', filters.cityIds);
    if (filters.minScore !== undefined) query = query.gte('score', filters.minScore);
    if (filters.capitalMax !== undefined) {
      query = query.lte('capital_required_min', filters.capitalMax);
    }
    if (filters.capitalMin !== undefined) {
      query = query.gte('capital_required_min', filters.capitalMin);
    }
    if (filters.deadlineFrom) {
      query = query.gte('closing_date', filters.deadlineFrom.toISOString());
    }
    if (filters.deadlineTo) {
      query = query.lte('closing_date', filters.deadlineTo.toISOString());
    }
    if (!filters.includeExpired) query = query.eq('is_expired', false);
    if (filters.closingSoon) query = query.eq('is_closing_soon', true);
    if (filters.q) {
      query = query.textSearch('search_vector', filters.q, {
        type: 'websearch',
        config: 'english',
      });
    }
    query = query.order('score', { ascending: false });
  }

  const { data, error } = await query;
  if (error) throw new Error(`Export query failed: ${error.message}`);

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const county = record.counties as { name?: string } | null;
    const city = record.cities as { name?: string } | null;
    return {
      ...(record as unknown as ExportableOpportunity),
      county_name: county?.name ?? null,
      city_name: city?.name ?? null,
    };
  });
}

export async function runExportJob(
  job: ExportJobRow,
  memberClient: SupabaseClient,
  maxAccessRank: number,
): Promise<{ rowCount: number; filePath: string }> {
  const admin = createAdminClient();
  const env = serverEnv();

  await admin
    .from('export_jobs')
    .update({ status: 'processing' })
    .eq('id', job.id);

  try {
    const rows = await collectRows(memberClient, job, maxAccessRank);
    const csv = toCsv(rows, opportunityExportColumns(publicEnv.siteUrl));

    // Objects are namespaced by user id: the storage policy grants a member
    // read access to their own prefix and nothing else.
    const filePath = `${job.user_id}/${exportFileName('opportunities')}`;

    const { error: uploadError } = await admin.storage
      .from(env.storageBuckets.exports)
      .upload(filePath, new Blob([csv], { type: 'text/csv' }), {
        contentType: 'text/csv',
        upsert: false,
      });

    if (uploadError) throw new Error(`Export upload failed: ${uploadError.message}`);

    await admin
      .from('export_jobs')
      .update({
        status: 'ready',
        row_count: rows.length,
        file_path: filePath,
        completed_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return { rowCount: rows.length, filePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await admin
      .from('export_jobs')
      .update({ status: 'failed', error_message: message })
      .eq('id', job.id);
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
