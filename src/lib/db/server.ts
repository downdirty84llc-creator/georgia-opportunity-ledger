import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

import type { Database } from '@/lib/db/types';
import { serverEnv } from '@/lib/env';

/**
 * Supabase client bound to the caller's session cookies.
 *
 * Queries made through this client run as the signed-in user, so row-level
 * security applies. This is the client every request handler should use for
 * member-facing reads: even if a handler forgets an access check, RLS still
 * refuses the row.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const env = serverEnv();

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(
        cookiesToSet: Array<{
          name: string;
          value: string;
          options?: CookieOptions;
        }>,
      ) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, {
              ...options,
              httpOnly: true,
              sameSite: 'lax',
              secure: process.env.NODE_ENV === 'production',
            });
          }
        } catch {
          // Server Components cannot set cookies. The middleware refreshes the
          // session on every request, so a failure here is expected and safe.
        }
      },
    },
  });
}

export type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;
