import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
import { checkRateLimit, rateLimitIdentity } from '@/lib/http/rate-limit';
import {
  apiError,
  ok,
  rateLimited,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ email: z.string().email().max(254) });
const passwordSchema = z.object({ password: z.string().min(12).max(200) });

/**
 * POST /api/v1/auth/password-reset
 *
 * Always answers the same way. Whether an address has an account is not
 * information this endpoint gives away.
 */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const limit = await checkRateLimit(
      'passwordReset',
      `${rateLimitIdentity(request, null)}|${parsed.data.email.toLowerCase()}`,
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const supabase = await createServerSupabaseClient();
    const callback = new URL('/auth/callback', publicEnv.siteUrl);
    callback.searchParams.set('next', '/auth/reset-password');
    const { error } = await supabase.auth.resetPasswordForEmail(
      parsed.data.email,
      {
        redirectTo: callback.toString(),
      },
    );

    if (error) {
      console.warn('[auth] password reset request failed', {
        message: error.message,
      });
    }

    return ok({
      message:
        'If that address has an account, a password reset link is on its way.',
    });
  },
);

/**
 * PUT /api/v1/auth/password-reset
 *
 * The app owns the session in HttpOnly cookies, so password changes must use
 * the request-bound server client too. No user ID or admin client is accepted.
 */
export const PUT = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) {
      return apiError('forbidden', 'Open the password form on this site.');
    }

    const parsed = passwordSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return apiError(
        'unauthorized',
        'Your session could not be verified. Request a fresh reset link.',
      );
    }

    const limit = await checkRateLimit(
      'passwordReset',
      rateLimitIdentity(request, user.id),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });
    if (error) {
      console.warn('[auth] password update failed', { message: error.message });
      return apiError(
        'bad_request',
        'Your password could not be changed. Request a fresh link and try again.',
      );
    }

    return ok({ message: 'Password changed.' }, undefined, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  },
);
