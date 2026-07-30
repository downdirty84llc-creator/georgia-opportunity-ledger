import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SupportForm } from '@/components/support/support-form';
import { getSessionContext } from '@/lib/auth/session';

export const metadata: Metadata = {
  title: 'Support',
  robots: { index: false, follow: false },
};

export default async function SupportPage() {
  const { viewer } = await getSessionContext();

  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">Support</h1>
      <p className="mt-2 text-sm text-ink-600">
        Billing questions, account help, data-export and deletion requests, and
        anything that looks wrong. Corrections to a specific record are faster
        through the correction form on the record itself.
      </p>
      {viewer.accountStatus === 'suspended' ? (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your account is suspended, so only account appeals can be submitted
          here. Choose the account category below.
        </p>
      ) : null}
      <div className="mt-8">
        <Suspense>
          <SupportForm
            isAuthenticated={viewer.isAuthenticated}
            isSuspended={viewer.accountStatus === 'suspended'}
          />
        </Suspense>
      </div>
    </div>
  );
}
