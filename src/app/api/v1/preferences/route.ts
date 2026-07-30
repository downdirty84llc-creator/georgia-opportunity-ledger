import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { track } from '@/lib/analytics/events';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  apiError,
  ok,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

const patchSchema = z
  .object({
    primaryUserType: z
      .enum([
        'business_owner',
        'investor',
        'contractor',
        'developer',
        'adviser',
        'commercial_property_professional',
        'other',
      ])
      .nullable()
      .optional(),
    capitalRangeMin: z.number().nonnegative().nullable().optional(),
    capitalRangeMax: z.number().nonnegative().nullable().optional(),
    preferredFrequency: z
      .enum(['immediate', 'daily', 'weekly', 'biweekly', 'monthly', 'never'])
      .optional(),
    emailAlertsEnabled: z.boolean().optional(),
    marketingEmailEnabled: z.boolean().optional(),
    timezone: z.string().trim().max(60).optional(),
    minimumScore: z.number().int().min(0).max(100).optional(),
    preferredCountyIds: z.array(z.string().uuid()).max(159).optional(),
    preferredIndustryIds: z.array(z.string().uuid()).max(50).optional(),
    preferredPropertyTypes: z.array(z.string().max(40)).max(20).optional(),
    preferredFundingTypes: z.array(z.string().max(40)).max(20).optional(),
    onboardingComplete: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.capitalRangeMin === undefined ||
      value.capitalRangeMax === undefined ||
      value.capitalRangeMin === null ||
      value.capitalRangeMax === null ||
      value.capitalRangeMin <= value.capitalRangeMax,
    { message: 'The lower capital figure must not exceed the upper one.' },
  );

const COLUMN_MAP: Record<string, string> = {
  primaryUserType: 'primary_user_type',
  capitalRangeMin: 'capital_range_min',
  capitalRangeMax: 'capital_range_max',
  preferredFrequency: 'preferred_frequency',
  emailAlertsEnabled: 'email_alerts_enabled',
  marketingEmailEnabled: 'marketing_email_enabled',
  timezone: 'timezone',
  minimumScore: 'minimum_score',
  preferredCountyIds: 'preferred_county_ids',
  preferredIndustryIds: 'preferred_industry_ids',
  preferredPropertyTypes: 'preferred_property_types',
  preferredFundingTypes: 'preferred_funding_types',
};

/** GET /api/v1/preferences */
export const GET = withErrorHandling(async (): Promise<NextResponse> => {
  const viewer = await getViewer();
  if (!viewer.isAuthenticated) {
    return apiError('unauthorized', 'Sign in to read your preferences.');
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', viewer.userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return ok(data ?? {});
});

/**
 * PATCH /api/v1/preferences
 *
 * Drives dashboard recommendations, weekly-report weighting and alert
 * matching. Row-level security scopes the row to its owner, so there is no way
 * to write another member's preferences even by supplying their id.
 */
export const PATCH = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to update your preferences.');
    }
    if (viewer.accountStatus !== 'active') {
      return apiError(
        'forbidden',
        'Preferences cannot be changed while your account is suspended.',
      );
    }

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const update: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMN_MAP)) {
      const value = (parsed.data as Record<string, unknown>)[key];
      if (value !== undefined) update[column] = value;
    }

    const supabase = await createServerSupabaseClient();

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from('user_preferences')
        .update(update)
        .eq('user_id', viewer.userId);
      if (error) throw new Error(error.message);
    }

    // Marking onboarding complete lives on the profile, not preferences.
    if (parsed.data.onboardingComplete !== undefined) {
      const { error } = await supabase
        .from('profiles')
        .update({ onboarding_complete: parsed.data.onboardingComplete })
        .eq('id', viewer.userId);
      if (error) throw new Error(error.message);

      if (parsed.data.onboardingComplete) {
        await track('onboarding_completed', {
          userId: viewer.userId,
          properties: { plan: viewer.planCode },
        });
      }
    }

    const { data } = await supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', viewer.userId)
      .maybeSingle();

    return ok(data ?? {});
  },
);
