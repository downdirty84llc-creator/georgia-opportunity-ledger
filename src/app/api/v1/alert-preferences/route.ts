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
          .enum([
            'immediate',
            'daily',
            'weekly',
            'biweekly',
            'monthly',
            'never',
          ])
          .optional(),
        minimumScore: z.number().int().min(0).max(100).optional(),
      }),
    )
    .max(ALERT_TYPES.length)
    .refine(
      (entries) =>
        new Set(entries.map((entry) => entry.alertType)).size ===
        entries.length,
      { message: 'Each alert type may appear only once.' },
    ),
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

  if (preferences.error) throw new Error(preferences.error.message);
  if (alertPreferences.error) throw new Error(alertPreferences.error.message);

  return ok({
    emailAlertsEnabled: preferences.data?.email_alerts_enabled ?? true,
    marketingEmailEnabled: preferences.data?.marketing_email_enabled ?? false,
    alertTypes: alertPreferences.data ?? [],
  });
});

/**
 * PUT /api/v1/alert-preferences
 *
 * Saves the master switches and supplied email choices in one database
 * transaction. Omitted alert types, frequencies and scores are preserved.
 *
 * Note what is *not* gated here: a member on any plan may switch an alert type
 * off. Entitlement decides whether an alert would ever have been sent, never
 * whether someone is allowed to stop it.
 */
export const PUT = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError(
        'unauthorized',
        'Sign in to update your alert preferences.',
      );
    }

    const parsed = putSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();

    const { error } = await supabase.rpc('save_email_preferences', {
      p_email_alerts_enabled: parsed.data.emailAlertsEnabled,
      p_marketing_email_enabled: parsed.data.marketingEmailEnabled,
      p_alert_types: parsed.data.alertTypes,
    });
    if (error) throw new Error(error.message);

    return ok({
      emailAlertsEnabled: parsed.data.emailAlertsEnabled,
      marketingEmailEnabled: parsed.data.marketingEmailEnabled,
      alertTypes: parsed.data.alertTypes,
    });
  },
);
