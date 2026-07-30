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

const ALERT_TYPES = [
  'high_score',
  'material_update',
  'closing_soon',
  'saved_search_match',
  'weekly_report',
  'premium_briefing',
  'deadline_reminder',
  'account',
  'billing',
] as const;

const putSchema = z.object({
  emailAlertsEnabled: z.boolean(),
  marketingEmailEnabled: z.boolean(),
  alertTypes: z
    .array(
      z.object({
        alertType: z.enum(ALERT_TYPES),
        enabled: z.boolean(),
        frequency: z
          .enum(['immediate', 'daily', 'weekly', 'biweekly', 'monthly', 'never'])
          .optional(),
        minimumScore: z.number().int().min(0).max(100).optional(),
      }),
    )
    .max(20),
});

/** GET /api/v1/alert-preferences */
export const GET = withErrorHandling(async (): Promise<NextResponse> => {
  const viewer = await getViewer();
  if (!viewer.isAuthenticated) {
    return apiError('unauthorized', 'Sign in to read your alert preferences.');
  }

  const supabase = await createServerSupabaseClient();
  const [preferences, alertPreferences] = await Promise.all([
    supabase
      .from('user_preferences')
      .select('email_alerts_enabled, marketing_email_enabled')
      .eq('user_id', viewer.userId)
      .maybeSingle(),
    supabase
      .from('alert_preferences')
      .select('alert_type, delivery_method, enabled, frequency, minimum_score')
      .eq('user_id', viewer.userId),
  ]);

  return ok({
    emailAlertsEnabled: preferences.data?.email_alerts_enabled ?? true,
    marketingEmailEnabled: preferences.data?.marketing_email_enabled ?? false,
    alertTypes: alertPreferences.data ?? [],
  });
});

/**
 * PUT /api/v1/alert-preferences
 *
 * Replaces the whole email preference set in one call, so the form cannot leave
 * a half-applied state if a request fails partway.
 *
 * Note what is *not* gated here: a member on any plan may switch an alert type
 * off. Entitlement decides whether an alert would ever have been sent, never
 * whether someone is allowed to stop it.
 */
export const PUT = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to update your alert preferences.');
    }

    const parsed = putSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();

    const { error: preferencesError } = await supabase
      .from('user_preferences')
      .update({
        email_alerts_enabled: parsed.data.emailAlertsEnabled,
        marketing_email_enabled: parsed.data.marketingEmailEnabled,
      })
      .eq('user_id', viewer.userId);

    if (preferencesError) throw new Error(preferencesError.message);

    if (parsed.data.alertTypes.length > 0) {
      const rows = parsed.data.alertTypes.map((entry) => ({
        user_id: viewer.userId,
        alert_type: entry.alertType,
        delivery_method: 'email' as const,
        enabled: entry.enabled,
        frequency: entry.frequency ?? 'immediate',
        minimum_score: entry.minimumScore ?? 0,
      }));

      const { error } = await supabase
        .from('alert_preferences')
        .upsert(rows, { onConflict: 'user_id,alert_type,delivery_method' });

      if (error) throw new Error(error.message);
    }

    return ok({
      emailAlertsEnabled: parsed.data.emailAlertsEnabled,
      marketingEmailEnabled: parsed.data.marketingEmailEnabled,
      alertTypes: parsed.data.alertTypes,
    });
  },
);
