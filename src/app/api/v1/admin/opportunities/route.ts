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
import { roleMayPerform } from '@/lib/opportunities/workflow';
import { OPPORTUNITY_CATEGORIES } from '@/lib/search/filters';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  title: z.string().trim().min(4).max(240),
  category: z.enum(OPPORTUNITY_CATEGORIES),
  subtype: z.string().trim().min(2).max(80),
  summary: z.string().trim().min(20).max(4000),
  sourceId: z.string().uuid(),
  originalSourceUrl: z.string().url().max(2000),
  stateId: z.string().uuid().optional(),
  countyId: z.string().uuid().optional(),
  cityId: z.string().uuid().optional(),
  industryId: z.string().uuid().optional(),
  minimumAccessRank: z.number().int().min(0).max(100).default(20),
  riskSummary: z.string().trim().max(4000).default(''),
  recommendedNextAction: z.string().trim().max(4000).default(''),
});

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 90);
}

/** GET /api/v1/admin/opportunities — the editorial queue. */
export const GET = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isStaff || viewer.accountStatus !== 'active') {
      return apiError('forbidden', 'Administrator access required.');
    }

    const url = new URL(request.url);
    const workflowStatus = url.searchParams.get('workflowStatus');

    const supabase = await createServerSupabaseClient();
    let query = supabase
      .from('opportunities')
      .select(
        'id, title, slug, category, workflow_status, status, score, ' +
          'closing_date, date_verified, reverification_due_at, created_by, ' +
          'created_at, updated_at, is_sample',
      )
      .order('updated_at', { ascending: false })
      .limit(200);

    if (workflowStatus) query = query.eq('workflow_status', workflowStatus);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return ok(data ?? [], { count: data?.length ?? 0 });
  },
);

/**
 * POST /api/v1/admin/opportunities
 *
 * Always creates a draft. Publishing is a separate, separately authorised
 * action — there is no way to create a published record in one call.
 */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (
      !viewer.isAuthenticated ||
      viewer.accountStatus !== 'active' ||
      !roleMayPerform(viewer.role, 'edit')
    ) {
      return apiError('forbidden', 'You cannot create opportunity records.');
    }

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();

    // Slugs are permanent public URLs, so collisions get a numeric suffix
    // rather than overwriting an existing record's address.
    const baseSlug = slugify(parsed.data.title) || 'opportunity';
    let slug = baseSlug;
    for (let attempt = 2; attempt <= 20; attempt += 1) {
      const { data: clash } = await supabase
        .from('opportunities')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();
      if (!clash) break;
      slug = `${baseSlug}-${attempt}`;
    }

    const { data, error } = await supabase
      .from('opportunities')
      .insert({
        title: parsed.data.title,
        slug,
        category: parsed.data.category,
        subtype: parsed.data.subtype,
        summary: parsed.data.summary,
        source_id: parsed.data.sourceId,
        original_source_url: parsed.data.originalSourceUrl,
        state_id: parsed.data.stateId ?? null,
        county_id: parsed.data.countyId ?? null,
        city_id: parsed.data.cityId ?? null,
        industry_id: parsed.data.industryId ?? null,
        minimum_access_rank: parsed.data.minimumAccessRank,
        risk_summary: parsed.data.riskSummary,
        recommended_next_action: parsed.data.recommendedNextAction,
        workflow_status: 'draft',
        status: 'under_review',
        created_by: viewer.userId,
      })
      .select('id, slug, title, workflow_status')
      .single();

    if (error) throw new Error(error.message);
    return created(data);
  },
);
