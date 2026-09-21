import type { NextResponse } from 'next/server';
import { NextResponse as Res } from 'next/server';

import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  checkRateLimit,
  rateLimitHeaders,
  rateLimitIdentity,
} from '@/lib/http/rate-limit';
import { apiError, rateLimited, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/account/data-export
 *
 * The subject-access export the Privacy Policy offers. Distinct from
 * `/api/v1/exports/opportunities`, which produces the paid research product —
 * this returns the member's own record and nothing else.
 *
 * Everything is read through the **session-bound** client, so row-level
 * security decides what is in the file. That is the point: this endpoint
 * cannot over-share even if the query is wrong, because every table it touches
 * is already restricted to the caller's own rows. A service-role client here
 * would turn a small mistake into somebody else's data.
 *
 * Delivered inline as JSON rather than through the export-job pipeline. A
 * member's own record is small, and making them wait for a worker — then
 * storing a second copy of their personal data in a bucket — is worse on both
 * counts.
 */
export const GET = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const context = await getSessionContext();
    const { viewer } = context;

    if (!viewer.isAuthenticated || !viewer.userId) {
      return apiError('unauthorized', 'Sign in to export your data.');
    }

    const limit = await checkRateLimit(
      'dataExport',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const supabase = await createServerSupabaseClient();

    const [
      profile,
      preferences,
      saved,
      searches,
      alerts,
      notifications,
      tickets,
      corrections,
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', viewer.userId).maybeSingle(),
      supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', viewer.userId)
        .maybeSingle(),
      supabase.from('saved_opportunities').select('*').eq('user_id', viewer.userId),
      supabase.from('saved_searches').select('*').eq('user_id', viewer.userId),
      supabase.from('alert_preferences').select('*').eq('user_id', viewer.userId),
      supabase
        .from('notifications')
        .select('id, notification_type, title, message, sent_at, read_at')
        .eq('user_id', viewer.userId)
        .order('sent_at', { ascending: false })
        .limit(1000),
      supabase.from('support_tickets').select('*').eq('user_id', viewer.userId),
      supabase
        .from('correction_requests')
        .select('*')
        .eq('submitted_by_user_id', viewer.userId),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      about: {
        scope:
          'Everything held about this account. Records naming you that we are ' +
          'required to retain — the billing ledger and the administrative ' +
          'audit trail — are summarised rather than reproduced.',
        cardData:
          'No card number has ever been held by this service. Payment details ' +
          'live only with Stripe.',
      },
      profile: profile.data ?? null,
      preferences: preferences.data ?? null,
      subscription: {
        plan: context.planCode,
        planName: context.planName,
        status: context.subscriptionStatus,
        currentPeriodEnd: context.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: context.cancelAtPeriodEnd,
      },
      savedOpportunities: saved.data ?? [],
      savedSearches: searches.data ?? [],
      alertPreferences: alerts.data ?? [],
      notifications: notifications.data ?? [],
      supportTickets: tickets.data ?? [],
      correctionRequests: corrections.data ?? [],
    };

    const filename = `ledger-data-export-${new Date().toISOString().slice(0, 10)}.json`;

    return Res.json(payload, {
      headers: {
        ...rateLimitHeaders(limit),
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Never let a shared cache hold a copy of somebody's personal record.
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
      },
    });
  },
);
