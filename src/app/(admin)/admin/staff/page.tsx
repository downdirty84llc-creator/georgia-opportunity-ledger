import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { StaffMfaTable } from '@/components/admin/staff-mfa-table';
import { Card, SectionHeading } from '@/components/ui/primitives';
import { listStaffFactors } from '@/lib/auth/mfa-admin';
import { getSessionContext } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Staff security',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function AdminStaffPage() {
  const { viewer } = await getSessionContext();
  if (viewer.role !== 'super_administrator') redirect('/admin');

  const staff = await listStaffFactors();
  const missing = staff.filter(
    (row) => row.mfaRequired && row.verifiedFactors === 0,
  ).length;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <SectionHeading
        eyebrow="Administration"
        title="Staff two-factor enrolment"
        description="Who has a second factor, and the recovery path for someone who has lost theirs."
      />

      <Card className="mb-6">
        <h2 className="text-base font-semibold">Before you reset anyone</h2>
        <ul className="mt-3 space-y-2 text-sm text-ink-700">
          <li>
            Confirm their identity by a channel other than email. Email is one
            of the things the second factor exists to protect, so a request that
            arrives by email proves only that someone can send email.
          </li>
          <li>
            A reset does not sign them out, change their password, or affect
            their member access. It clears the enrolled factor so they can enrol
            again from a device they still have.
          </li>
          <li>
            Every reset is audited with your name, theirs, the factors removed
            and the reason you give. It is visible in the{' '}
            <a href="/admin/audit" className="underline">
              audit log
            </a>
            .
          </li>
        </ul>
      </Card>

      {missing > 0 ? (
        <p
          role="status"
          className="mb-6 rounded-md border border-amber-700 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {missing} staff account{missing === 1 ? ' has' : 's have'} no second
          factor. They can still use the member side, but the admin area will
          ask them to enrol before it opens.
        </p>
      ) : null}

      <StaffMfaTable staff={staff} actorId={viewer.userId as string} />
    </div>
  );
}
