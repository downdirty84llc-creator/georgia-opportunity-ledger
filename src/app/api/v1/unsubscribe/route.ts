import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/db/admin';
import { resolveUnsubscribeToken } from '@/lib/email/unsubscribe-registry';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Unsubscribe without signing in.
 *
 * `POST` is what RFC 8058 one-click clients send; `GET` is what a member
 * clicking the footer link sends, and it redirects somewhere that confirms what
 * just happened. Both do the same thing.
 *
 * A valid token only ever turns email off, so a leaked or guessed token cannot
 * be used to read anything or to enable anything.
 */
async function applyUnsubscribe(token: string | null): Promise<boolean> {
  if (!token) return false;

  const claim = await resolveUnsubscribeToken(token);
  if (!claim) return false;

  const supabase = createAdminClient();
  const update: Record<string, boolean> = {};

  if (claim.scope === 'alerts' || claim.scope === 'all') {
    update.email_alerts_enabled = false;
  }
  if (claim.scope === 'marketing' || claim.scope === 'all') {
    update.marketing_email_enabled = false;
  }

  const { error } = await supabase
    .from('user_preferences')
    .update(update)
    .eq('user_id', claim.userId);

  if (error) {
    throw new Error('Could not update email preferences.');
  }

  // Switching off every alert type is what "all" means to a member, so honour
  // that rather than leaving individual alert preferences enabled.
  if (claim.scope === 'all') {
    const { error: alertError } = await supabase
      .from('alert_preferences')
      .update({ enabled: false })
      .eq('user_id', claim.userId);
    if (alertError) throw new Error('Could not update alert preferences.');
  }

  return true;
}

function unavailable(): NextResponse {
  return NextResponse.json(
    {
      error: {
        code: 'temporarily_unavailable',
        message: 'We could not save your email preferences. Please try again.',
      },
    },
    { status: 503, headers: { 'Retry-After': '30' } },
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  let token = url.searchParams.get('token');

  // One-click clients may send the token in the body instead.
  if (!token) {
    const body = await request.text().catch(() => '');
    token = new URLSearchParams(body).get('token');
  }

  try {
    const applied = await applyUnsubscribe(token);
    return NextResponse.json(
      { data: { unsubscribed: applied } },
      { status: applied ? 200 : 400 },
    );
  } catch {
    return unavailable();
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  let applied: boolean;
  try {
    applied = await applyUnsubscribe(url.searchParams.get('token'));
  } catch {
    return unavailable();
  }
  const base = publicEnv.siteUrl.replace(/\/$/, '');

  return NextResponse.redirect(
    `${base}/unsubscribed?status=${applied ? 'ok' : 'invalid'}`,
  );
}
