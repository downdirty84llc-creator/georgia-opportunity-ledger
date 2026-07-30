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

const sectionSchema = z.object({
  sectionType: z
    .enum([
      'executive_summary',
      'market_commentary',
      'property_highlights',
      'funding_highlights',
      'pricing_indicators',
      'deadline_calendar',
      'methodology',
      'disclaimer',
      'custom',
    ])
    .default('custom'),
  title: z.string().trim().min(1).max(200),
  content: z.string().max(20000).nullable().optional(),
  minimumAccessRank: z.number().int().min(0).max(100).default(0),
});

const entrySchema = z.object({
  opportunityId: z.string().uuid(),
  editorCommentary: z.string().max(4000).nullable().optional(),
  minimumAccessRank: z.number().int().min(0).max(100).default(0),
});

const patchSchema = z.object({
  title: z.string().trim().min(4).max(240).optional(),
  reportType: z
    .enum(['weekly', 'monthly', 'special', 'pricing', 'premium_briefing', 'sample'])
    .optional(),
  periodStart: z.coerce.date().nullable().optional(),
  periodEnd: z.coerce.date().nullable().optional(),
  minimumAccessRank: z.number().int().min(0).max(100).optional(),
  executiveSummary: z.string().max(20000).nullable().optional(),
  marketCommentary: z.string().max(20000).nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  /** Replaces the whole ordered list when present. */
  sections: z.array(sectionSchema).max(30).optional(),
  opportunities: z.array(entrySchema).max(60).optional(),
});

async function requireEditor() {
  const viewer = await getViewer();
  const allowed =
    viewer.isAuthenticated &&
    viewer.accountStatus === 'active' &&
    ['editor', 'super_administrator'].includes(viewer.role);
  return { viewer, allowed };
}

/** GET /api/v1/admin/reports/{id} — the composer's data. */
export const GET = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const { allowed } = await requireEditor();
    if (!allowed) return apiError('forbidden', 'Editor access required.');

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('reports')
      .select(
        `*,
         report_sections ( id, section_type, title, content, display_order,
                           minimum_access_rank ),
         report_opportunities ( opportunity_id, display_order, editor_commentary,
                                minimum_access_rank )`,
      )
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return apiError('not_found', 'Report not found.');
    return ok(data);
  },
);

/**
 * PATCH /api/v1/admin/reports/{id}
 *
 * Sections and the opportunity list are replace-in-full rather than
 * incremental. The composer reorders by dragging, which changes many rows at
 * once; sending the whole ordered list means the stored order can never end up
 * half-applied with duplicate display positions.
 */
export const PATCH = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const { allowed } = await requireEditor();
    if (!allowed) return apiError('forbidden', 'Editor access required.');

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);
    const body = parsed.data;

    const supabase = await createServerSupabaseClient();

    const { data: existing } = await supabase
      .from('reports')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return apiError('not_found', 'Report not found.');

    const update: Record<string, unknown> = {};
    if (body.title !== undefined) update.title = body.title;
    if (body.reportType !== undefined) update.report_type = body.reportType;
    if (body.minimumAccessRank !== undefined) {
      update.minimum_access_rank = body.minimumAccessRank;
    }
    if (body.executiveSummary !== undefined) {
      update.executive_summary = body.executiveSummary;
    }
    if (body.marketCommentary !== undefined) {
      update.market_commentary = body.marketCommentary;
    }
    if (body.periodStart !== undefined) {
      update.reporting_period_start =
        body.periodStart?.toISOString().slice(0, 10) ?? null;
    }
    if (body.periodEnd !== undefined) {
      update.reporting_period_end =
        body.periodEnd?.toISOString().slice(0, 10) ?? null;
    }
    if (body.scheduledAt !== undefined) {
      update.scheduled_at = body.scheduledAt?.toISOString() ?? null;
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase.from('reports').update(update).eq('id', id);
      if (error) throw new Error(error.message);
    }

    if (body.sections) {
      const { error: deleteError } = await supabase
        .from('report_sections')
        .delete()
        .eq('report_id', id);
      if (deleteError) throw new Error(deleteError.message);

      if (body.sections.length > 0) {
        const { error } = await supabase.from('report_sections').insert(
          body.sections.map((section, index) => ({
            report_id: id,
            section_type: section.sectionType,
            title: section.title,
            content: section.content ?? null,
            minimum_access_rank: section.minimumAccessRank,
            display_order: index,
          })),
        );
        if (error) throw new Error(error.message);
      }
    }

    if (body.opportunities) {
      const { error: deleteError } = await supabase
        .from('report_opportunities')
        .delete()
        .eq('report_id', id);
      if (deleteError) throw new Error(deleteError.message);

      if (body.opportunities.length > 0) {
        const { error } = await supabase.from('report_opportunities').insert(
          body.opportunities.map((entry, index) => ({
            report_id: id,
            opportunity_id: entry.opportunityId,
            editor_commentary: entry.editorCommentary ?? null,
            minimum_access_rank: entry.minimumAccessRank,
            display_order: index,
          })),
        );
        if (error) throw new Error(error.message);
      }
    }

    const { data } = await supabase
      .from('reports')
      .select('id, slug, title, status, updated_at')
      .eq('id', id)
      .maybeSingle();

    return ok(data);
  },
);
