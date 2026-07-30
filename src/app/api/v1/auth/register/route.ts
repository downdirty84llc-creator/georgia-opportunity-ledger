import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { track } from '@/lib/analytics/events';
import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
import {
  checkRateLimit,
  rateLimitIdentity,
} from '@/lib/http/rate-limit';
import {
  created,
  rateLimited,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z
    .string()
    .min(12, 'Use at least 12 characters.')
    .max(200, 'That password is too long.'),
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  companyName: z.string().trim().max(160).optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must accept the terms to continue.' }),
  }),
});

/**
 * POST /api/v1/auth/register
 *
 * The profile and free subscription rows are created by database triggers on
 * `auth.users`, so an account is never half-created if this handler is
 * interrupted between calls.
 */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const limit = await checkRateLimit(
      'register',
      rateLimitIdentity(request, null),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${publicEnv.siteUrl.replace(/\/$/, '')}/auth/callback`,
        data: {
          first_name: parsed.data.firstName ?? '',
          last_name: parsed.data.lastName ?? '',
          company_name: parsed.data.companyName ?? '',
        },
      },
    });

    if (error) {
      // Never confirm whether an address is already registered — that turns
      // this endpoint into an account-enumeration oracle (spec 26).
      console.warn('[auth] sign-up failed', { message: error.message });
      return created({
        pendingVerification: true,
        message:
          'Check your email to confirm your address and finish setting up your account.',
      });
    }

    if (data.user) {
      const now = new Date().toISOString();
      await supabase
        .from('profiles')
        .update({
          company_name: parsed.data.companyName ?? null,
          terms_accepted_at: now,
          privacy_accepted_at: now,
        })
        .eq('id', data.user.id);

      await track('account_created', {
        userId: data.user.id,
        properties: { hasCompany: Boolean(parsed.data.companyName) },
      });
    }

    return created({
      pendingVerification: !data.session,
      message: data.session
        ? 'Your account is ready.'
        : 'Check your email to confirm your address and finish setting up your account.',
    });
  },
);
