import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/db/types';
import { publicEnv } from '@/lib/env';

let cached: SupabaseClient<Database> | null = null;

/**
 * Anonymous client with no session and no cookies.
 *
 * This is what public marketing pages must use. The cookie-bound client calls
 * `cookies()`, which forces the whole route to render per request — so a
 * landing page reading nothing but public teaser views would still be
 * uncacheable, and spec 23 asks for exactly those pages to be cached.
 *
 * Reading without a session is safe here because every projection these pages
 * touch is already granted to `anon` and carries no paid content:
 * `opportunity_previews`, `market_indicator_previews`, `report_previews`,
 * `subscription_plans` (active only) and the geography tables. Row-level
 * security is still in force; there is simply no user for it to widen access
 * for.
 */
export function createPublicSupabaseClient(): SupabaseClient<Database> {
  if (cached) return cached;

  cached = createClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: { 'x-application-name': 'georgia-opportunity-ledger/public' },
      },
    },
  );
  return cached;
}
