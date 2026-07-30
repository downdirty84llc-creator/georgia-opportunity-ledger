import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SiteFooter } from '@/components/site/footer';
import { SiteHeader } from '@/components/site/header';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export const metadata: Metadata = {
  title: 'Reset your password',
  robots: { index: false, follow: false },
};

/**
 * Serves both halves of the reset flow.
 *
 * Arriving from the sign-in page shows the "email me a link" form. Arriving
 * from the emailed link carries a recovery session, so the same page shows the
 * "choose a new password" form instead — one URL, no dead end if a member
 * bookmarks it.
 */
export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <main id="main" className="flex-1">
        <div className="mx-auto max-w-md px-4 py-14 sm:px-6">
          <Suspense>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
