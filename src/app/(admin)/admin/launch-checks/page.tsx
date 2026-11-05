import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { EmailTestPanel } from '@/components/admin/email-test-panel';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Launch checks',
  robots: { index: false, follow: false },
};
export default async function LaunchChecksPage() {
  const viewer = await getViewer();
  if (viewer.role !== 'super_administrator') redirect('/admin');
  const client = await createServerSupabaseClient();
  const [
    {
      data: { user },
    },
    { data: report },
  ] = await Promise.all([
    client.auth.getUser(),
    client
      .from('reports')
      .select('id')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <EmailTestPanel reportId={report?.id ?? null} email={user?.email ?? ''} />
    </div>
  );
}
