import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  apiError,
  created,
  ok,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().trim().min(4).max(240),
  reportType: z
    .enum(['weekly', 'monthly', 'special', 'pricing', 'premium_briefing', 'sample'])
    .default('weekly'),
  periodStart: z.coerce.date().optional(),
  periodEnd: z.coerce.date().optional(),
  minimumAccessRank: z.number().int().min(0).max(100).default(10),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

/** GET /api/v1/admin/reports — the editorial report list. */
export const GET = withErrorHandling(async (): Promise<NextResponse> => {
  const viewer = await getViewer();
  if (!viewer.isStaff || viewer.accountStatus !== 'active') {
    return apiError('forbidden', 'Administrator access required.');
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('reports')
    .select(
      'id, title, slug, report_type, status, minimum_access_rank, ' +
        'scheduled_at, published_at, distributed_at, created_at, is_sample',
    )
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) throw new Error(error.message);
  return ok(data ?? [], { count: data?.length ?? 0 });
});

/** POST /api/v1/admin/reports */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (
      !viewer.isAuthenticated ||
      viewer.accountStatus !== 'active' ||
      !['editor', 'super_administrator'].includes(viewer.role)
    ) {
      return apiError('forbidden', 'Only an editor can create reports.');
    }

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();
    const baseSlug = slugify(parsed.data.title) || 'report';
    let slug = baseSlug;
    for (let attempt = 2; attempt <= 20; attempt += 1) {
      const { data: clash } = await supabase
        .from('reports')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (!clash) break;
      slug = `${baseSlug}-${attempt}`;
    }

    const { data, error } = await supabase
      .from('reports')
      .insert({
        title: parsed.data.title,
        slug,
        report_type: parsed.data.reportType,
        reporting_period_start:
          parsed.data.periodStart?.toISOString().slice(0, 10) ?? null,
        reporting_period_end:
          parsed.data.periodEnd?.toISOString().slice(0, 10) ?? null,
        minimum_access_rank: parsed.data.minimumAccessRank,
        status: 'draft',
        created_by: viewer.userId,
      })
      .select('id, title, slug, status')
      .single();

    if (error) throw new Error(error.message);
    return created(data);
  },
);
