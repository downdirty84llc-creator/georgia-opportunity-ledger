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

const bodySchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('password'),
    email: z.string().email().max(254),
    password: z.string().min(1).max(200),
  }),
  z.object({
    method: z.literal('magic_link'),
    email: z.string().email().max(254),
  }),
]);

/** POST /api/v1/auth/login — password or magic link. */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    // Limit per address as well as per IP, so a distributed attempt against one
    // account is still throttled.
    const identity = `${rateLimitIdentity(request, null)}|${parsed.data.email.toLowerCase()}`;
    const limit = await checkRateLimit('login', identity);
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const supabase = await createServerSupabaseClient();

    if (parsed.data.method === 'magic_link') {
      await supabase.auth.signInWithOtp({
        email: parsed.data.email,
        options: {
          emailRedirectTo: `${publicEnv.siteUrl.replace(/\/$/, '')}/auth/callback`,
        },
      });
      // Always the same answer, whether or not the address exists.
      return ok({
        message:
          'If that address has an account, a sign-in link is on its way.',
      });
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });

    if (error || !data.user) {
      return apiError('unauthorized', 'That email or password is incorrect.');
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_status')
      .eq('id', data.user.id)
      .maybeSingle();

    if (profile?.account_status === 'closed') {
      await supabase.auth.signOut();
      return apiError('forbidden', 'This account has been closed.');
    }

    // A suspended account can still sign in — it needs to reach the appeal
    // form — but every member capability is refused by the entitlement layer.
    await supabase
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', data.user.id);

    return ok({
      userId: data.user.id,
      suspended: profile?.account_status === 'suspended',
    });
  },
);
