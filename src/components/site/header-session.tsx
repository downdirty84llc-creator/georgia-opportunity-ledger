'use client';

import { useEffect, useState } from 'react';

import {
  ANONYMOUS_HEADER_SESSION,
  HeaderActions,
  HeaderNav,
  type HeaderSession,
} from '@/components/site/header-actions';

/**
 * Remembers that the last resolved session was signed in.
 *
 * Not a credential and not trusted for anything: it decides which *shape* of
 * header to paint for the ~200ms before `/api/v1/auth/session` answers, and is
 * corrected the moment it does. Without it a returning member sees "Join now"
 * flash on every marketing page; with it an anonymous visitor — who has never
 * set the flag — sees the signed-out markup that was in the static HTML all
 * along, with no flash either way.
 */
const SIGNED_IN_HINT = 'ledger:signed-in';

function readHint(): boolean {
  try {
    return window.localStorage.getItem(SIGNED_IN_HINT) === '1';
  } catch {
    return false;
  }
}

function writeHint(signedIn: boolean): void {
  try {
    if (signedIn) window.localStorage.setItem(SIGNED_IN_HINT, '1');
    else window.localStorage.removeItem(SIGNED_IN_HINT);
  } catch {
    // Private browsing or a full quota. The hint is an optimisation.
  }
}

/**
 * The session-aware half of the public header.
 *
 * This exists so the marketing pages can be cached. Reading the session on the
 * server means calling `cookies()`, and a layout that calls `cookies()` makes
 * every page beneath it render per request — which defeats the `revalidate`
 * exports the landing pages already declare (spec 23).
 *
 * The cost is that the signed-in header arrives one round trip after the page.
 * That is the right trade for public pages: their content is identical for
 * everyone, the personalised part is two links, and nothing gated is rendered
 * here. The member and admin shells, which are dynamic regardless, still
 * render their header entirely on the server.
 */
export function HeaderSessionArea() {
  const [session, setSession] = useState<HeaderSession>(
    ANONYMOUS_HEADER_SESSION,
  );

  useEffect(() => {
    // Paint the remembered shape first so the swap, if any, happens before the
    // network answers rather than after it.
    if (readHint()) {
      setSession((current) =>
        current.authenticated ? current : { ...current, authenticated: true },
      );
    }

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch('/api/v1/auth/session', {
          signal: controller.signal,
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!response.ok) return;

        const body: unknown = await response.json();
        const data = (body as { data?: Record<string, unknown> }).data ?? {};
        const authenticated = data.authenticated === true;

        writeHint(authenticated);
        setSession({
          authenticated,
          isStaff: data.isStaff === true,
          planCode: typeof data.planCode === 'string' ? data.planCode : 'free',
          planName:
            typeof data.planName === 'string' ? data.planName : 'Free Preview',
        });
      } catch {
        // An offline or aborted request leaves the header signed-out. Every
        // link it would have shown is reachable from the footer, and the
        // pages behind them check entitlements themselves.
      }
    })();

    return () => controller.abort();
  }, []);

  return (
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
  );
}
