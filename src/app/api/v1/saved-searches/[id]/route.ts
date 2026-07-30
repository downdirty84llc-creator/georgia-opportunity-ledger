import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { canSaveSearch } from '@/lib/access/entitlements';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  apiError,
  denied,
  noContent,
  ok,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';
import { filterSchema } from '@/lib/search/filters';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    filters: z.record(z.unknown()).optional(),
    minimumScore: z.number().int().min(0).max(100).optional(),
    alertEnabled: z.boolean().optional(),
    alertFrequency: z
      .enum(['immediate', 'daily', 'weekly', 'biweekly', 'monthly', 'never'])
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

/** PATCH /api/v1/saved-searches/{id} */
export const PATCH = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to update a saved search.');
    }

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    // Turning alerting back on is a Premium capability, so it is re-checked
    // here rather than only at creation — a member may have downgraded since.
    if (parsed.data.alertEnabled === true) {
      const decision = canSaveSearch(viewer, 0);
      if (!decision.allowed) return denied(decision);
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) update.name = parsed.data.name;
    if (parsed.data.minimumScore !== undefined) {
      update.minimum_score = parsed.data.minimumScore;
    }
    if (parsed.data.alertEnabled !== undefined) {
      update.alert_enabled = parsed.data.alertEnabled;
    }
    if (parsed.data.alertFrequency !== undefined) {
      update.alert_frequency = parsed.data.alertFrequency;
    }
    if (parsed.data.filters !== undefined) {
      const filterResult = filterSchema.safeParse(parsed.data.filters);
      if (!filterResult.success) return validationFailed(filterResult.error);
      const { cursor: _cursor, limit: _limit, ...storable } = filterResult.data;
      update.filter_configuration = JSON.parse(JSON.stringify(storable));
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('saved_searches')
      .update(update)
      .eq('id', id)
      .eq('user_id', viewer.userId)
      .select('id, name, filter_configuration, minimum_score, alert_enabled, alert_frequency')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return apiError('not_found', 'Saved search not found.');
    return ok(data);
  },
);

/** DELETE /api/v1/saved-searches/{id} */
export const DELETE = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (_request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to delete a saved search.');
    }

    const supabase = await createServerSupabaseClient();
    const { error } = await supabase
      .from('saved_searches')
      .delete()
      .eq('id', id)
      .eq('user_id', viewer.userId);

    if (error) throw new Error(error.message);
    return noContent();
  },
);
