import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  apiError,
  ok,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  distributeByEmail: z.boolean().default(false),
  scheduledAt: z.coerce.date().optional(),
});

/**
 * POST /api/v1/admin/reports/{id}/publish
 *
 * Publishing marks the report readable; email distribution is a separate flag
 * handled by the weekly-distribution job, so a report can go live quietly and
 * be mailed later (or never).
 */
export const POST = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const viewer = await getViewer();

    if (
      !viewer.isAuthenticated ||
      viewer.accountStatus !== 'active' ||
      !['editor', 'super_administrator'].includes(viewer.role)
    ) {
      return apiError('forbidden', 'Only an editor can publish a report.');
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();
    const { data: report } = await supabase
      .from('reports')
      .select('id, status, title, executive_summary')
      .eq('id', id)
      .maybeSingle();

    if (!report) return apiError('not_found', 'Report not found.');
    if (report.status === 'published') {
      return apiError('conflict', 'That report is already published.');
    }
    if (!report.executive_summary) {
      return apiError(
        'conflict',
        'A report needs an executive summary before it can be published.',
      );
    }

    const now = new Date();
    const scheduled = parsed.data.scheduledAt;
    const isFuture = scheduled ? scheduled > now : false;

    const { data, error } = await supabase
      .from('reports')
      .update({
        status: isFuture ? 'scheduled' : 'published',
        scheduled_at: scheduled?.toISOString() ?? null,
        published_at: isFuture ? null : now.toISOString(),
        approved_by: viewer.userId,
      })
      .eq('id', id)
      .select('id, slug, status, published_at, scheduled_at')
      .single();

    if (error) throw new Error(error.message);

    await supabase.rpc('log_admin_action', {
      p_action: isFuture ? 'report.scheduled' : 'report.published',
      p_entity_type: 'report',
      p_entity_id: id,
      p_previous: { status: report.status },
      p_new: { status: data.status, distribute: parsed.data.distributeByEmail },
    });

    return ok({
      ...data,
      distributionQueued: parsed.data.distributeByEmail && !isFuture,
      message: isFuture
        ? 'Report scheduled. It will publish automatically at the scheduled time.'
        : 'Report published.',
    });
  },
);
