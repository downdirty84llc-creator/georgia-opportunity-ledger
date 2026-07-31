import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { MfaSetup } from '@/components/admin/mfa-setup';
import { Card, SectionHeading } from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { getMfaStatus, mfaRequiredForRole } from '@/lib/auth/mfa';

export const metadata: Metadata = {
  title: 'Administrator security',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function AdminSecurityPage() {
  const { viewer } = await getSessionContext();
  if (!viewer.isStaff) redirect('/dashboard');

  const status = await getMfaStatus(mfaRequiredForRole(viewer.role));

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <SectionHeading
        eyebrow="Administration"
        title="Two-factor authentication"
        description="Required for every staff role before the admin area will open. A support representative can read member accounts and a billing manager can move money — both are worth a second factor."
      />

      <MfaSetup
        state={status.state}
        factorId={status.factorId}
        role={viewer.role}
      />

      <Card className="mt-6">
        <h2 className="text-base font-semibold">What this protects</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>
            Publishing and unpublishing records that subscribers act on with
            real money.
          </li>
          <li>Member account status, roles and access overrides.</li>
          <li>Refunds, promotional codes and subscription records.</li>
          <li>
            The audit log — which is append-only precisely so that a compromised
            account cannot cover its tracks.
          </li>
        </ul>
        <p className="mt-4 text-sm text-ink-600">
          Losing your authenticator locks you out of the admin area, not out of
          your account — the member side keeps working. Ask a super
          administrator to clear your enrolment from{' '}
          <a href="/admin/staff" className="underline">
            Staff
          </a>
          , then enrol again on this page. The clearing is itself audited, and
          nobody can clear their own.
        </p>
      </Card>
    </div>
  );
}
