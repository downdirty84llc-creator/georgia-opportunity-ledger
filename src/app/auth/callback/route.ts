import { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * GET /auth/callback
 *
 * Lands email-confirmation, magic-link and OAuth redirects. Exchanges the code
 * for a session and forwards to the dashboard (or a safe `next` path).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next');

  const siteUrl = publicEnv.siteUrl.replace(/\/$/, '');
  const safeNext =
    next && next.startsWith('/') && !next.startsWith('//')
      ? next
      : '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${siteUrl}/login`);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.warn('[auth] code exchange failed', { message: error.message });
    return NextResponse.redirect(`${siteUrl}/login?error=link_expired`);
  }

  return NextResponse.redirect(`${siteUrl}${safeNext}`);
}
