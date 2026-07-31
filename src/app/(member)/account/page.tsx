import type { Metadata } from 'next';
import Link from 'next/link';

import { BillingPortalButton } from '@/components/account/billing-portal-button';
import {
  ButtonLink,
  Card,
  DataRow,
  Pill,
  SectionHeading,
} from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import {
  needsPaymentAttention,
  paidAccessEndsAt,
} from '@/lib/billing/subscription';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, titleCase } from '@/lib/format';

export const metadata: Metadata = { title: 'Account' };
export const dynamic = 'force-dynamic';

const PRIVACY_CONTROLS = [
  {
    title: 'Email preferences',
    body: 'Choose which alerts, reminders and reports you receive.',
    href: '/account/email-preferences',
  },
  {
    title: 'Export your data',
    body: 'A machine-readable copy of your profile, preferences, saved records and notes.',
    href: '/support?topic=data_export',
  },
  {
    title: 'Delete your account',
    body: 'Removes your profile, preferences, saved records and searches. Billing records we are required to retain are kept.',
    href: '/support?topic=account_deletion',
  },
  {
    title: 'Cookie preferences',
    body: 'Analytics cookies can be switched off without losing any functionality.',
    href: '/legal/cookies',
  },
];

export default async function AccountPage() {
  const session = await getSessionContext();
  const { viewer } = session;
  const supabase = await createServerSupabaseClient();

  const { data: preferences } = await supabase
    .from('user_preferences')
    .select(
      `primary_user_type, capital_range_min, capital_range_max,
       preferred_frequency, email_alerts_enabled, marketing_email_enabled,
       timezone, minimum_score`,
    )
    .eq('user_id', viewer.userId)
    .maybeSingle();

  const accessEnds = paidAccessEndsAt(session.subscription);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">Account</h1>

      <section className="mt-8">
        <SectionHeading title="Profile" />
        <Card>
          <dl>
            <DataRow
              label="Name"
              value={
                [session.profile?.firstName, session.profile?.lastName]
                  .filter(Boolean)
                  .join(' ') || '—'
              }
            />
            <DataRow
              label="Company"
              value={session.profile?.companyName ?? '—'}
            />
            <DataRow label="Role" value={titleCase(viewer.role)} />
            <DataRow
              label="Account status"
              value={
                <Pill
                  tone={
                    viewer.accountStatus === 'active' ? 'positive' : 'warning'
                  }
                >
                  {titleCase(viewer.accountStatus)}
                </Pill>
              }
            />
          </dl>
        </Card>
      </section>

      <section className="mt-10">
        <SectionHeading title="Subscription" action={<BillingPortalButton />} />
        <Card>
          <dl>
            <DataRow label="Plan" value={session.planName} />
            <DataRow
              label="Status"
              value={titleCase(session.subscriptionStatus ?? 'free')}
            />
            <DataRow
              label={session.cancelAtPeriodEnd ? 'Access ends' : 'Renews'}
              value={formatDate(accessEnds ?? session.currentPeriodEnd)}
            />
            <DataRow label="Access rank" value={String(viewer.accessRank)} />
          </dl>

          {needsPaymentAttention(session.subscription) ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Your last payment did not go through. Update your payment method
              to keep your access. Nothing you have saved will be lost either
              way.
            </p>
          ) : null}

          {session.cancelAtPeriodEnd ? (
            <p className="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
              Your subscription is set to end at the close of the current
              period. Until then nothing changes, and afterwards your account
              stays open at the free tier.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {viewer.planCode !== 'premium' ? (
              <ButtonLink href="/pricing">Change plan</ButtonLink>
            ) : null}
          </div>
        </Card>
      </section>

      <section className="mt-10">
        <SectionHeading
          title="Preferences"
          description="These drive your dashboard recommendations, the weighting of your weekly report, and which records trigger alerts."
          action={
            <ButtonLink href="/account/preferences" variant="secondary">
              Edit preferences
            </ButtonLink>
          }
        />
        <Card>
          <dl>
            <DataRow
              label="I am a"
              value={titleCase(preferences?.primary_user_type ?? 'not set')}
            />
            <DataRow
              label="Capital range"
              value={
                preferences?.capital_range_min || preferences?.capital_range_max
                  ? `${preferences?.capital_range_min ?? 0} – ${preferences?.capital_range_max ?? '∞'}`
                  : 'Not set'
              }
            />
            <DataRow
              label="Minimum score for alerts"
              value={String(preferences?.minimum_score ?? 0)}
            />
            <DataRow
              label="Report frequency"
              value={titleCase(preferences?.preferred_frequency ?? 'weekly')}
            />
            <DataRow
              label="Alert emails"
              value={preferences?.email_alerts_enabled ? 'On' : 'Off'}
            />
            <DataRow
              label="Marketing emails"
              value={preferences?.marketing_email_enabled ? 'On' : 'Off'}
            />
            <DataRow
              label="Time zone"
              value={preferences?.timezone ?? 'America/New_York'}
            />
          </dl>
        </Card>
      </section>

      <section className="mt-10">
        <SectionHeading
          title="Privacy and data"
          description="Everything spec 21 requires you to be able to do, in one place."
        />
        <ul className="grid gap-4 sm:grid-cols-2">
          {PRIVACY_CONTROLS.map((control) => (
            <li key={control.title}>
              <Card className="h-full">
                <h3 className="text-base font-semibold">{control.title}</h3>
                <p className="mt-1 text-sm text-ink-600">{control.body}</p>
                <Link
                  href={control.href}
                  className="mt-3 inline-block text-sm font-medium underline"
                >
                  {control.title}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <SectionHeading title="Security" />
        <Card>
          <p className="text-sm text-ink-700">
            Password changes and multi-factor enrolment are handled through the
            sign-in flow. Administrator accounts are required to enrol in
            multi-factor authentication before they can use the admin area.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/auth/reset-password" variant="secondary">
              Change password
            </ButtonLink>
            <form action="/api/v1/auth/logout" method="post">
              <button
                type="submit"
                className="inline-flex items-center rounded-lg border border-ink-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-ink-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </Card>
      </section>
    </div>
  );
}
