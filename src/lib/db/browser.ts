'use client';

import { createBrowserClient } from '@supabase/ssr';

import { publicEnv } from '@/lib/env';

/**
 * Browser client, used only for authentication flows (sign in, sign out,
 * password reset) and realtime. Data reads go through the API routes so that
 * entitlement decisions and analytics happen in one place.
 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey);
}
