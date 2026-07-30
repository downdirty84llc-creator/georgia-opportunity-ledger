import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/db/types';
import { serverEnv } from '@/lib/env';

export type AdminSupabaseClient = SupabaseClient<Database>;

let cached: AdminSupabaseClient | null = null;

/**
 * Service-role client. Bypasses row-level security entirely.
 *
 * Legitimate callers are: the Stripe webhook handler (it writes subscription
 * state for a user who is not the caller), the background jobs, and the seed
 * script. Nothing that runs on behalf of a signed-in member should use this —
 * use `createServerSupabaseClient()` so RLS stays in the loop.
 */
export function createAdminClient(): AdminSupabaseClient {
  if (cached) return cached;

  const env = serverEnv();
  cached = createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: { 'x-application-name': 'georgia-opportunity-ledger/admin' },
    },
  });
  return cached;
}
