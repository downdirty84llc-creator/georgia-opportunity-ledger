import Link from 'next/link';

import {
  HeaderActions,
  HeaderNav,
  type HeaderSession,
} from '@/components/site/header-actions';
import { HeaderSessionArea } from '@/components/site/header-session';

export type { HeaderSession };

interface SiteHeaderProps {
  /**
   * An already-resolved session, for shells that have one.
   *
   * Omit it on public pages. The header then resolves the session in the
   * browser instead, which is what keeps the marketing routes cacheable — see
   * `header-session.tsx`. Pass it anywhere the route is dynamic already
   * (member, admin), so the correct header is in the first byte.
   */
  session?: HeaderSession;
}

export function SiteHeader({ session }: SiteHeaderProps) {
  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink-900 text-sm font-bold text-white"
          >
            GA
          </span>
          <span className="text-[15px] leading-tight">
            Georgia
            <br className="hidden sm:block" /> Opportunity Ledger
          </span>
        </Link>

        {session ? (
          <>
            <nav
              aria-label="Primary"
              className="order-last w-full overflow-x-auto sm:order-none sm:w-auto sm:flex-1"
            >
              <HeaderNav session={session} />
            </nav>
            <div className="ml-auto flex min-h-[2.5rem] items-center gap-3">
              <HeaderActions session={session} />
            </div>
          </>
        ) : (
          <HeaderSessionArea />
        )}
      </div>
    </header>
  );
}
