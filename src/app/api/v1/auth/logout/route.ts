import type { NextResponse } from 'next/server';

import { createServerSupabaseClient } from '@/lib/db/server';
import { noContent, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

/** POST /api/v1/auth/logout */
export const POST = withErrorHandling(async (): Promise<NextResponse> => {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  return noContent();
});
