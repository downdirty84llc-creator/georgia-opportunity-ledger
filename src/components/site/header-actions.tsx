import Link from 'next/link';

import { ButtonLink } from '@/components/ui/primitives';

export interface HeaderSession {
  authenticated: boolean;
  isStaff: boolean;
  planCode: string;
  planName: string;
}

export const ANONYMOUS_HEADER_SESSION: HeaderSession = {
  authenticated: false,
  isStaff: false,
  planCode: 'free',
  planName: 'Free Preview',
};

export const PUBLIC_LINKS = [
  { href: '/commercial-property', label: 'Commercial Property' },
  { href: '/funding', label: 'Funding' },
  { href: '/pricing-reports', label: 'Pricing Reports' },
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/insights', label: 'Free Insights' },
] as const;

export const MEMBER_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/opportunities', label: 'Opportunities' },
  { href: '/reports', label: 'Reports' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/saved', label: 'Saved' },
  { href: '/account', label: 'Account' },
] as const;

/**
 * The navigation list and the account area, as pure markup.
 *
 * Deliberately free of data access so both callers can use it: the member and
 * admin shells render it on the server from an already-resolved session, and
 * the marketing shell renders it on the client once `/api/v1/auth/session`
 * answers. Keeping one implementation is what stops the two paths drifting
 * into two subtly different headers.
 */
export function HeaderNav({ session }: { session: HeaderSession }) {
  const links = session.authenticated ? MEMBER_LINKS : PUBLIC_LINKS;

  return (
    <ul className="flex items-center gap-1 whitespace-nowrap text-sm">
      {links.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            className="rounded-md px-2.5 py-1.5 text-ink-700 hover:bg-ink-100 hover:text-ink-900"
          >
            {link.label}
          </Link>
        </li>
      ))}
      {session.isStaff ? (
        <li>
          <Link
            href="/admin"
            className="rounded-md bg-clay-50 px-2.5 py-1.5 font-medium text-clay-800 hover:bg-clay-100"
          >
            Admin
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

export function HeaderActions({ session }: { session: HeaderSession }) {
  if (!session.authenticated) {
    return (
      <>
        <Link
          href="/login"
          className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100"
        >
          Log in
        </Link>
        <ButtonLink href="/register" className="py-2">
          Join now
        </ButtonLink>
      </>
    );
  }

  return (
    <>
      <span className="hidden text-xs text-ink-500 sm:inline">
        {session.planName}
      </span>
      {session.planCode !== 'premium' && !session.isStaff ? (
        <ButtonLink href="/pricing" variant="secondary" className="py-2">
          Upgrade
        </ButtonLink>
      ) : null}
    </>
  );
}
