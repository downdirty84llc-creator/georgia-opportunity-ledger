import { readJsonBody } from '@/lib/http/request-body';
import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { canCancelDeletion } from '@/lib/account/deletion';
import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
import { checkAuthRateLimit } from '@/lib/http/auth-rate-limit';
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
    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return validationFailed(parsed.error);

    const limit = await checkAuthRateLimit('login', request, parsed.data.email);
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const supabase = await createServerSupabaseClient();

    if (parsed.data.method === 'magic_link') {
      await supabase.auth.signInWithOtp({
        email: parsed.data.email,
        options: {
          // Supabase otherwise creates an account for an unknown address,
          // bypassing registration and its required terms acceptance.
          shouldCreateUser: false,
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
      .select('account_status, deletion_requested_at')
      .eq('id', data.user.id)
      .maybeSingle();

    const deletionPending =
      profile?.account_status === 'closed' &&
      canCancelDeletion({
        accountStatus: 'closed',
        requestedAt: profile.deletion_requested_at
          ? new Date(profile.deletion_requested_at)
          : null,
      });

    // The grace period promises a way to sign back in and withdraw deletion.
    // Authentication does not reopen the profile or restore entitlements.
    if (profile?.account_status === 'closed' && !deletionPending) {
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
      deletionPending,
    });
  },
);
