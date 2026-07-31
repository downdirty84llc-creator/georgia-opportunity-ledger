import { redirect } from 'next/navigation';

import { SiteFooter } from '@/components/site/footer';
import { SiteHeader } from '@/components/site/header';
import { getSessionContext } from '@/lib/auth/session';

/**
 * Member area shell.
 *
 * The redirect here is a convenience, not the security boundary: every API
 * route re-checks entitlements and row-level security refuses paid rows
 * regardless. Spec 23 requires that protected content is never rendered before
 * a redirect, which is why this is an async server component — nothing is sent
 * to the browser until the session has resolved.
 */
export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { viewer, planCode, planName } = await getSessionContext();

  if (!viewer.isAuthenticated) {
    redirect('/login?next=/dashboard');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        session={{
          authenticated: true,
          isStaff: viewer.isStaff,
          planCode,
          planName,
        }}
      />
      {viewer.accountStatus === 'suspended' ? (
        <p className="bg-red-800 px-4 py-2 text-center text-sm text-white">
          Your account is suspended. Member content, exports and alerts are
          unavailable.{' '}
          <a href="/support" className="underline">
            Contact support to appeal
          </a>
          .
        </p>
      ) : null}
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
