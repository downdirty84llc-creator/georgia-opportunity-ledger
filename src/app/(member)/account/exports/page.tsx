import type { Metadata } from 'next';
import Link from 'next/link';
import { ExportHistory } from '@/components/account/export-history';
import { canExportCsv } from '@/lib/access/entitlements';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';

export const metadata: Metadata = { title: 'CSV exports' };
export const dynamic = 'force-dynamic';

export default async function ExportsPage() {
  const viewer = await getViewer();
  const decision = canExportCsv(viewer);
  if (!decision.allowed)
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <h1>CSV exports</h1>
        <p>Exports require an active Premium account.</p>
        <Link href="/pricing" className="underline">
          View plans
        </Link>
      </div>
    );
  const client = await createServerSupabaseClient();
  const { data, error } = await client
    .from('export_jobs')
    .select('id,status,row_count,requested_at,expires_at,truncated')
    .eq('user_id', viewer.userId)
    .order('requested_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">CSV exports</h1>
      <p className="mt-3 text-ink-600">
        Your 20 most recent exports. Files expire after seven days. Queued
        exports usually start within five minutes.
      </p>
      <ExportHistory jobs={data ?? []} />
    </div>
  );
}
