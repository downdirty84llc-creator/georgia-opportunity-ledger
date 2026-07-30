import type { Metadata } from 'next';

import { PreferencesForm } from '@/components/account/preferences-form';
import { SectionHeading } from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';

export const metadata: Metadata = { title: 'Preferences' };
export const dynamic = 'force-dynamic';

export default async function PreferencesPage() {
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const [preferences, counties, industries] = await Promise.all([
    supabase
      .from('user_preferences')
      .select('*')
      .eq('user_id', viewer.userId)
      .maybeSingle(),
    supabase
      .from('counties')
      .select('id, name, slug')
      .eq('is_active', true)
      .order('name', { ascending: true }),
    supabase
      .from('industries')
      .select('id, name, slug')
      .eq('is_active', true)
      .order('display_order', { ascending: true }),
  ]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <SectionHeading
        eyebrow="Account"
        title="Preferences"
        description="These decide what your dashboard recommends, how your weekly report is weighted, and which records are worth interrupting you for."
      />
      <PreferencesForm
        initial={preferences.data ?? {}}
        counties={counties.data ?? []}
        industries={industries.data ?? []}
        immediateAlertsEntitled={viewer.features.immediateAlerts}
      />
    </div>
  );
}
