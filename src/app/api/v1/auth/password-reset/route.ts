import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
import {
  checkRateLimit,
  rateLimitIdentity,
} from '@/lib/http/rate-limit';
import {
  ok,
  rateLimited,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ email: z.string().email().max(254) });

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
    const { error } = await supabase.auth.resetPasswordForEmail(
      parsed.data.email,
      {
        redirectTo: `${publicEnv.siteUrl.replace(/\/$/, '')}/auth/reset-password`,
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
