import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { canSaveSearch } from '@/lib/access/entitlements';
import { track } from '@/lib/analytics/events';
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
import { filterSchema } from '@/lib/search/filters';

export const dynamic = 'force-dynamic';

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  filters: z.record(z.unknown()).default({}),
  minimumScore: z.number().int().min(0).max(100).default(0),
  alertEnabled: z.boolean().default(true),
  alertFrequency: z
    .enum(['immediate', 'daily', 'weekly', 'biweekly', 'monthly', 'never'])
    .default('immediate'),
});

/** GET /api/v1/saved-searches — Premium capability (spec 10.4). */
export const GET = withErrorHandling(async (): Promise<NextResponse> => {
  const viewer = await getViewer();
  if (!viewer.isAuthenticated) {
    return apiError('unauthorized', 'Sign in to view your saved searches.');
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('saved_searches')
    .select(
      `id, name, filter_configuration, minimum_score, alert_enabled,
       alert_frequency, last_run_at, last_match_at, created_at`,
    )
    .eq('user_id', viewer.userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  // A member who downgrades keeps their saved searches — the alerts stop, the
  // records do not vanish (spec 9). The flag lets the UI say exactly that.
  const alertsActive = viewer.features.savedSearchLimit !== 0;

  return ok(
    (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      filters: row.filter_configuration,
      minimumScore: row.minimum_score,
      alertEnabled: row.alert_enabled && alertsActive,
      alertFrequency: row.alert_frequency,
      lastRunAt: row.last_run_at,
      lastMatchAt: row.last_match_at,
      alertsSuspendedByPlan: row.alert_enabled && !alertsActive,
    })),
    { count: data?.length ?? 0 },
  );
});

/** POST /api/v1/saved-searches */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to save a search.');
    }

    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    // Normalise the filter document through the same schema the search page
    // uses, so a stored search can never express something search cannot run.
    const filterResult = filterSchema.safeParse(parsed.data.filters);
    if (!filterResult.success) return validationFailed(filterResult.error);

    const supabase = await createServerSupabaseClient();
    const { count, error: countError } = await supabase
      .from('saved_searches')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', viewer.userId);
    if (countError) throw new Error(countError.message);

    const decision = canSaveSearch(viewer, count ?? 0);
    if (!decision.allowed) return denied(decision);

    const { cursor: _cursor, limit: _limit, ...storable } = filterResult.data;

    const { data, error } = await supabase
      .from('saved_searches')
      .insert({
        user_id: viewer.userId,
        name: parsed.data.name,
        // Dates must round-trip as ISO strings inside jsonb.
        filter_configuration: JSON.parse(JSON.stringify(storable)),
        minimum_score: parsed.data.minimumScore,
        alert_enabled: parsed.data.alertEnabled,
        alert_frequency: parsed.data.alertFrequency,
      })
      .select('id, name, alert_enabled, alert_frequency')
      .single();

    if (error) {
      if (error.code === '23505') {
        return apiError('conflict', 'You already have a search with that name.');
      }
      throw new Error(error.message);
    }

    await track('saved_search_created', {
      userId: viewer.userId,
      properties: { plan: viewer.planCode, alertFrequency: parsed.data.alertFrequency },
    });

    return created(data);
  },
);
