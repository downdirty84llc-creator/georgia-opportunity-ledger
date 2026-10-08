import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { track } from '@/lib/analytics/events';
import { createAdminClient } from '@/lib/db/admin';
import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
import { checkRateLimit, rateLimitIdentity } from '@/lib/http/rate-limit';
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

      // Service-role, not the request client. Email confirmation is required,
      // so `signUp` returns no session — `auth.uid()` is null, the
      // `profiles_update_own` policy (`id = auth.uid()`) matches nothing, and
      // this update silently wrote zero rows. Consent was collected on the form
      // and then not recorded: every account created before this fix has
      // `terms_accepted_at` null. `track()` below worked throughout, because it
      // already used the admin client.
      //
      // The row itself is made by the trigger on `auth.users`, so this only
      // ever fills in columns on a row that exists, scoped to the one id.
      const { error: profileError } = await createAdminClient()
        .from('profiles')
        .update({
          company_name: parsed.data.companyName ?? null,
          terms_accepted_at: now,
          privacy_accepted_at: now,
        })
        .eq('id', data.user.id);

      // Not fatal — the account exists and the address still needs confirming,
      // so failing the request would be worse than an incomplete profile. But
      // it is never silent again: an unrecorded acceptance is the kind of gap
      // that is only ever noticed when somebody asks for proof of it.
      if (profileError) {
        console.error('[auth] recording terms acceptance failed', {
          userId: data.user.id,
          message: profileError.message,
        });
      }

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
