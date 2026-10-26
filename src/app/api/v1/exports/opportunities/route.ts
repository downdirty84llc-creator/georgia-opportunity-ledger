import { readJsonBody } from '@/lib/http/request-body';
import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { canExportCsv } from '@/lib/access/entitlements';
import { track } from '@/lib/analytics/events';
import { getViewer } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/db/admin';
import { createServerSupabaseClient } from '@/lib/db/server';
import { shouldGenerateAsynchronously } from '@/lib/exports/csv';
import { runExportJob, signExportDownload } from '@/lib/exports/service';
import { checkRateLimit, rateLimitIdentity } from '@/lib/http/rate-limit';
import {
  apiError,
  created,
  denied,
  rateLimited,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';
import { filterSchema } from '@/lib/search/filters';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const bodySchema = z.object({
  filters: z.record(z.string(), z.unknown()).optional(),
  savedSearchId: z.string().uuid().optional(),
  opportunityIds: z.array(z.string().uuid()).min(1).max(5000).optional(),
  format: z.enum(['csv']).default('csv'),
});

/**
 * POST /api/v1/exports/opportunities — Premium only (spec 10.7).
 *
 * Small exports are generated inline so the member gets a link straight away.
 * Anything large enough to risk the request timeout is queued for the worker,
 * and the client polls GET /api/v1/exports/{id}.
 */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();

    const decision = canExportCsv(viewer);
    if (!decision.allowed) return denied(decision);

    const limit = await checkRateLimit(
      'export',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const parsed = bodySchema.safeParse(
      await readJsonBody(request, { allowEmpty: true }),
    );
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();

    let filterConfiguration: Record<string, unknown> = {};
    if (parsed.data.savedSearchId) {
      const { data: savedSearch, error: savedError } = await supabase
        .from('saved_searches')
        .select('filter_configuration')
        .eq('id', parsed.data.savedSearchId)
        .eq('user_id', viewer.userId)
        .maybeSingle();
      if (savedError) throw new Error(savedError.message);
      if (!savedSearch) return apiError('not_found', 'Saved search not found.');
      const stored = filterSchema.safeParse(
        savedSearch.filter_configuration ?? {},
      );
      if (!stored.success) return validationFailed(stored.error);
      filterConfiguration = JSON.parse(JSON.stringify(stored.data));
    } else if (parsed.data.filters) {
      const filterResult = filterSchema.safeParse(parsed.data.filters);
      if (!filterResult.success) return validationFailed(filterResult.error);
      const { cursor: _c, limit: _l, ...storable } = filterResult.data;
      filterConfiguration = JSON.parse(JSON.stringify(storable));
    }

    const admin = createAdminClient();
    const { data: job, error } = await admin
      .from('export_jobs')
      .insert({
        user_id: viewer.userId,
        format: parsed.data.format,
        status: 'queued',
        filter_configuration: filterConfiguration,
        saved_search_id: parsed.data.savedSearchId ?? null,
        opportunity_ids: parsed.data.opportunityIds ?? null,
      })
      .select(
        'id, user_id, format, status, filter_configuration, saved_search_id, opportunity_ids, file_path',
      )
      .single();

    if (error) throw new Error(error.message);

    await track('csv_exported', {
      userId: viewer.userId,
      properties: {
        plan: viewer.planCode,
        bySavedSearch: Boolean(parsed.data.savedSearchId),
        selectionCount: parsed.data.opportunityIds?.length ?? 0,
      },
    });

    const estimatedRows = parsed.data.opportunityIds?.length ?? 0;
    if (
      !parsed.data.opportunityIds ||
      shouldGenerateAsynchronously(estimatedRows)
    ) {
      return created({
        id: job.id,
        status: 'queued',
        message:
          'Your export is queued. Open Account → Exports to check progress and download it.',
      });
    }

    const completed = await runExportJob(
      job as unknown as Parameters<typeof runExportJob>[0],
    );
    if (!completed)
      return created({
        id: job.id,
        status: 'queued',
        message:
          'Your export is being prepared. Check Account → Exports for progress.',
      });
    const { rowCount, filePath, truncated } = completed;
    const downloadUrl = await signExportDownload(filePath);

    return created({
      id: job.id,
      status: 'ready',
      rowCount,
      truncated,
      downloadUrl,
      message: `${rowCount} record${rowCount === 1 ? '' : 's'} exported.${truncated ? ' This export reached the 5,000-record limit; narrow your filters for the rest.' : ''}`,
    });
  },
);
