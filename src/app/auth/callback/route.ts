import { NextResponse } from 'next/server';

import {
  noticeForCallbackError,
  safeNextPath,
} from '@/lib/auth/callback-notice';
import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * GET /auth/callback
 *
 * Lands email-confirmation, magic-link and OAuth redirects. Exchanges the code
 * for a session and forwards to the dashboard (or a safe `next` path).
 *
 * Every path that does not end in a session forwards a reason. It previously
 * forwarded none, so a refused link and a plain visit to this URL both left
 * the member on an unexplained sign-in page — see `callback-notice.ts`.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  const siteUrl = publicEnv.siteUrl.replace(/\/$/, '');
  const safeNext = safeNextPath(url.searchParams.get('next'));
  const failurePath =
    safeNext === '/auth/reset-password' ? '/auth/reset-password' : '/login';

  function redirect(path: string) {
    const response = NextResponse.redirect(`${siteUrl}${path}`);
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  // GoTrue refused the link. Read before `code`, because an error arrives
  // *instead* of a code and would otherwise be indistinguishable from someone
  // opening this URL directly.
  const errorNotice = noticeForCallbackError(url.searchParams);
  if (errorNotice) {
    console.warn('[auth] confirmation link refused', {
      error: url.searchParams.get('error'),
      code: url.searchParams.get('error_code'),
      description: url.searchParams.get('error_description'),
    });
    return redirect(`${failurePath}?notice=${errorNotice}`);
  }

  if (!code) {
    return redirect(failurePath);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Not reported as an expired link. The usual cause is the email being
    // opened in a different browser from the one that registered, so the PKCE
    // verifier cookie is absent — the link is fine, this browser is not the
    // one that started the flow. The real reason goes to the log.
    console.warn('[auth] code exchange failed', { message: error.message });
    return redirect(`${failurePath}?notice=signin_required`);
  }

  return redirect(safeNext);
}
