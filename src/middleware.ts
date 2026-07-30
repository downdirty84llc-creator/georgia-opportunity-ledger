import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Session refresh, route guarding, and pathname propagation.
 *
 * Three jobs:
 *
 *   1. Refresh the Supabase session cookie. Server Components cannot write
 *      cookies, so without this a session would silently expire mid-visit.
 *   2. Redirect signed-out visitors away from member and admin routes *before*
 *      any protected markup is generated. Spec 23 requires that protected page
 *      authorisation never leaks content ahead of the redirect.
 *   3. Forward the pathname as a request header. A layout cannot otherwise know
 *      which route it is wrapping, and the admin layout needs to exempt the
 *      two-factor setup page from its own two-factor gate — otherwise enrolment
 *      is unreachable behind a redirect loop.
 *
 * This is a convenience layer, not the security boundary. Every API route
 * re-checks entitlements and row-level security refuses paid rows regardless of
 * what happens here.
 */

export const PATHNAME_HEADER = 'x-ledger-pathname';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/opportunities',
  '/saved',
  '/calendar',
  '/reports',
  '/account',
  '/admin',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, pathname);

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase configured there is no session to refresh; let the request
  // through so that a misconfigured preview shows the app rather than a wall.
  if (!supabaseUrl || !supabaseAnonKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: CookieOptions;
        }>,
      ) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, {
            ...options,
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
          });
        }
      },
    },
  });

  // getUser() validates the token with the auth server rather than trusting the
  // cookie, and refreshes it as a side effect.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image optimisation, which never
     * carry a session and would only add latency.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
