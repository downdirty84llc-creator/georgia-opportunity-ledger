import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  apiError,
  noContent,
  ok,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const SAVED_STATUSES = [
  'reviewing',
  'contacted_source',
  'documents_requested',
  'lender_review',
  'legal_review',
  'site_visit',
  'application_started',
  'bid_planned',
  'not_pursuing',
  'completed',
] as const;

const patchSchema = z
  .object({
    status: z.enum(SAVED_STATUSES).optional(),
    personalNotes: z.string().max(4000).nullable().optional(),
    followUpDate: z.coerce.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

/** PATCH /api/v1/saved-opportunities/{id} */
export const PATCH = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to update a saved opportunity.');
    }

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const update: Record<string, unknown> = {};
    if (parsed.data.status !== undefined) update.status = parsed.data.status;
    if (parsed.data.personalNotes !== undefined) {
      update.personal_notes = parsed.data.personalNotes;
    }
    if (parsed.data.followUpDate !== undefined) {
      update.follow_up_date =
        parsed.data.followUpDate?.toISOString().slice(0, 10) ?? null;
    }

    const supabase = await createServerSupabaseClient();
    // The `user_id` predicate is belt-and-braces: row-level security already
    // restricts this table to the owner.
    const { data, error } = await supabase
      .from('saved_opportunities')
      .update(update)
      .eq('id', id)
      .eq('user_id', viewer.userId)
      .select('id, status, personal_notes, follow_up_date')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return apiError('not_found', 'Saved opportunity not found.');

    return ok(data);
  },
);

/** DELETE /api/v1/saved-opportunities/{id} */
export const DELETE = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to remove a saved opportunity.');
    }

    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from('saved_opportunities')
      .delete()
      .eq('id', id)
      .eq('user_id', viewer.userId);

    if (error) throw new Error(error.message);
    return noContent();
  },
);
