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

const bodySchema = z
  .object({
    opportunityId: z.string().uuid().optional(),
    reportId: z.string().uuid().optional(),
    description: z.string().trim().min(20).max(8000),
    supportingUrl: z.string().url().max(2000).optional(),
  })
  .refine((value) => value.opportunityId || value.reportId, {
    message: 'A correction must reference a record or a report.',
  });

/** POST /api/v1/corrections — the corrections policy, as an endpoint. */
export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();
    if (!viewer.isAuthenticated) {
      return apiError('unauthorized', 'Sign in to submit a correction.');
    }
    if (viewer.accountStatus !== 'active') {
      return apiError(
        'forbidden',
        'Corrections cannot be submitted while your account is suspended.',
      );
    }

    const limit = await checkRateLimit(
      'correction',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from('correction_requests')
      .insert({
        submitted_by_user_id: viewer.userId,
        opportunity_id: parsed.data.opportunityId ?? null,
        report_id: parsed.data.reportId ?? null,
        description: parsed.data.description,
        supporting_url: parsed.data.supportingUrl ?? null,
      })
      .select('id, status')
      .single();

    if (error) throw new Error(error.message);

    await track('correction_submitted', {
      userId: viewer.userId,
      properties: {
        hasOpportunity: Boolean(parsed.data.opportunityId),
        hasReport: Boolean(parsed.data.reportId),
        hasSource: Boolean(parsed.data.supportingUrl),
      },
    });

    return created(data);
  },
);
