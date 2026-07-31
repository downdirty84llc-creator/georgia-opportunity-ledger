import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { track } from '@/lib/analytics/events';
import { canSaveOpportunity } from '@/lib/access/entitlements';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  apiError,
  created,
  denied,
  ok,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  opportunityId: z.string().uuid(),
  personalNotes: z.string().max(4000).optional(),
  followUpDate: z.coerce.date().optional(),
});

/** GET /api/v1/saved-opportunities — the caller's saved list. */
export const GET = withErrorHandling(async (): Promise<NextResponse> => {
  const viewer = await getViewer();
  if (!viewer.isAuthenticated) {
    return apiError(
      'unauthorized',
      'Sign in to view your saved opportunities.',
    );
  }

  const supabase = await createServerSupabaseClient();

  // Saved records survive suspension and downgrade (spec 9): a member who
  // lapses keeps the list, they just cannot open every record on it.
  const { data, error } = await supabase
    .from('saved_opportunities')
    .select(
      `
      id, status, personal_notes, follow_up_date, saved_at,
      opportunity_version_at_save,
      opportunities (
        id, slug, title, category, status, score, score_classification,
        closing_date, is_closing_soon, is_expired, minimum_access_rank,
        updated_at, is_sample
      )
    `,
    )
    .eq('user_id', viewer.userId)
    .order('saved_at', { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((row) => {
    const opportunity = Array.isArray(row.opportunities)
      ? row.opportunities[0]
      : row.opportunities;
    return {
      id: row.id,
      status: row.status,
      personalNotes: row.personal_notes,
      followUpDate: row.follow_up_date,
      savedAt: row.saved_at,
      // Set when the record changed materially after it was saved, so the
      // list can flag "updated since you saved this".
      hasUpdates: Boolean(
        opportunity &&
        row.opportunity_version_at_save !== null &&
        new Date(opportunity.updated_at) > new Date(row.saved_at),
      ),
      opportunity: opportunity
        ? {
            id: opportunity.id,
            slug: opportunity.slug,
            title: opportunity.title,
            category: opportunity.category,
            status: opportunity.status,
            score: opportunity.score,
            classification: opportunity.score_classification,
            closingDate: opportunity.closing_date,
            isClosingSoon: opportunity.is_closing_soon,
            isExpired: opportunity.is_expired,
            isSample: opportunity.is_sample,
            isLocked: viewer.accessRank < opportunity.minimum_access_rank,
          }
        : null,
    };
  });

  return ok(rows, { count: rows.length });
});

/** POST /api/v1/saved-opportunities — save a record, subject to plan limits. */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to save an opportunity.');
    }

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();

    const { count, error: countError } = await supabase
      .from('saved_opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', viewer.userId);

    if (countError) throw new Error(countError.message);

    const decision = canSaveOpportunity(viewer, count ?? 0);
    if (!decision.allowed) return denied(decision);

    const { data, error } = await supabase
      .from('saved_opportunities')
      .insert({
        user_id: viewer.userId,
        opportunity_id: parsed.data.opportunityId,
        personal_notes: parsed.data.personalNotes ?? null,
        follow_up_date:
          parsed.data.followUpDate?.toISOString().slice(0, 10) ?? null,
      })
      .select('id, status, saved_at')
      .single();

    if (error) {
      // 23505 is the unique (user_id, opportunity_id) constraint.
      if (error.code === '23505') {
        return apiError('conflict', 'You have already saved this opportunity.');
      }
      throw new Error(error.message);
    }

    await track('opportunity_saved', {
      userId: viewer.userId,
      properties: {
        opportunityId: parsed.data.opportunityId,
        plan: viewer.planCode,
        savedCount: (count ?? 0) + 1,
      },
    });

    return created(data);
  },
);
