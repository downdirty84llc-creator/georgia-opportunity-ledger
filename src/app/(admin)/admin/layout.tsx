import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SiteFooter } from '@/components/site/footer';
import { getSessionContext } from '@/lib/auth/session';

const ADMIN_LINKS = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/review-queue', label: 'Review queue' },
  { href: '/admin/opportunities', label: 'Opportunities' },
  { href: '/admin/reports', label: 'Reports' },
  { href: '/admin/sources', label: 'Sources' },
  { href: '/admin/audit', label: 'Audit log' },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { viewer } = await getSessionContext();

  // Administrator access is decided by role, never by subscription plan
  // (spec 9). A Premium member has rank 30 and no admin access whatsoever.
  if (!viewer.isAuthenticated) redirect('/login?next=/admin');
  if (!viewer.isStaff || viewer.accountStatus !== 'active') redirect('/dashboard');

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-ink-200 bg-ink-950 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/admin" className="font-semibold">
            Ledger Admin
          </Link>
          <nav aria-label="Administration" className="flex-1 overflow-x-auto">
            <ul className="flex items-center gap-1 whitespace-nowrap text-sm">
              {ADMIN_LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="rounded-md px-2.5 py-1.5 text-ink-200 hover:bg-ink-800 hover:text-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-ink-300">
              {viewer.role.replace(/_/g, ' ')}
            </span>
            <Link
              href="/dashboard"
              className="rounded-md border border-ink-700 px-2.5 py-1.5 hover:bg-ink-800"
            >
              Member view
            </Link>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
