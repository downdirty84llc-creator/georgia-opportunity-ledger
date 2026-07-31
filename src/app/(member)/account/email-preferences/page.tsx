import type { Metadata } from 'next';

import { EmailPreferencesForm } from '@/components/account/email-preferences-form';
import { SectionHeading } from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';

export const metadata: Metadata = {
  title: 'Email preferences',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{ unsubscribe?: string }>;
};

export default async function EmailPreferencesPage({
  searchParams,
}: PageProps) {
  const { unsubscribe } = await searchParams;
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const [preferences, alertPreferences] = await Promise.all([
    supabase
      .from('user_preferences')
      .select('email_alerts_enabled, marketing_email_enabled')
      .eq('user_id', viewer.userId)
      .maybeSingle(),
    supabase
      .from('alert_preferences')
      .select('id, alert_type, enabled, frequency')
      .eq('user_id', viewer.userId),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <SectionHeading
        eyebrow="Account"
        title="Email preferences"
        description="Choose exactly which email reaches you. Essential account and billing messages — a failed payment, a password reset — are always sent, because they are not marketing."
      />
      <EmailPreferencesForm
        emailAlertsEnabled={preferences.data?.email_alerts_enabled ?? true}
        marketingEmailEnabled={
          preferences.data?.marketing_email_enabled ?? false
        }
        alertPreferences={alertPreferences.data ?? []}
        immediateAlertsEntitled={viewer.features.immediateAlerts}
        weeklyReportsEntitled={viewer.features.weeklyReports}
        prefillUnsubscribe={unsubscribe === '1'}
      />
    </div>
  );
}
