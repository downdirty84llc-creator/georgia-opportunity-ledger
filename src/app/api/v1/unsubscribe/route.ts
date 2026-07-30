import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/db/admin';
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe';
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

  const claim = verifyUnsubscribeToken(token);
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
    console.error('[unsubscribe] could not apply', error.message);
    return false;
  }

  // Switching off every alert type is what "all" means to a member, so honour
  // that rather than leaving individual alert preferences enabled.
  if (claim.scope === 'all') {
    await supabase
      .from('alert_preferences')
      .update({ enabled: false })
      .eq('user_id', claim.userId);
  }

  return true;
}

export async function POST(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  let token = url.searchParams.get('token');

  // One-click clients may send the token in the body instead.
  if (!token) {
    const body = await request.text().catch(() => '');
    token = new URLSearchParams(body).get('token');
  }

  const applied = await applyUnsubscribe(token);
  return NextResponse.json(
    { data: { unsubscribed: applied } },
    { status: applied ? 200 : 400 },
  );
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const applied = await applyUnsubscribe(url.searchParams.get('token'));
  const base = publicEnv.siteUrl.replace(/\/$/, '');

  return NextResponse.redirect(
    `${base}/unsubscribed?status=${applied ? 'ok' : 'invalid'}`,
  );
}
