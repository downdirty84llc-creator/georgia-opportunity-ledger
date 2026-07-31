import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { track } from '@/lib/analytics/events';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { checkRateLimit, rateLimitIdentity } from '@/lib/http/rate-limit';
import {
  apiError,
  created,
  rateLimited,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  category: z.enum([
    'account',
    'billing',
    'technical',
    'content_question',
    'data_correction',
    'accessibility',
    'privacy_request',
    'other',
  ]),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(8000),
});

/**
 * POST /api/v1/support/tickets
 *
 * A suspended account may open an account appeal and nothing else — the same
 * rule the row-level security policy enforces (spec 9).
 */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to open a support ticket.');
    }

    const limit = await checkRateLimit(
      'contact',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    if (
      viewer.accountStatus !== 'active' &&
      parsed.data.category !== 'account'
    ) {
      return apiError(
        'forbidden',
        'While your account is suspended, only account appeals can be submitted.',
      );
    }

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        user_id: viewer.userId,
        category: parsed.data.category,
        subject: parsed.data.subject,
        message: parsed.data.message,
        priority:
          parsed.data.category === 'privacy_request' ? 'high' : 'normal',
      })
      .select('id, status')
      .single();

    if (error) throw new Error(error.message);

    await track('support_ticket_submitted', {
      userId: viewer.userId,
      properties: { category: parsed.data.category },
    });

    return created(data);
  },
);
