/**
 * Where does Supabase Auth actually send a confirmed email?
 *
 * The application asks for the right destination: `/api/v1/auth/register` sets
 * `emailRedirectTo` to `${siteUrl}/auth/callback`. That request is a wish, not
 * an instruction. GoTrue honours `redirect_to` only when it matches the
 * project's **Redirect URLs** allow-list, and otherwise silently substitutes
 * the project's **Site URL** — which on a project nobody has pointed at
 * production is `http://localhost:3000`.
 *
 * Nothing in the repository can see that setting, and nothing in the signup
 * response reveals it: the account is created, the email sends, the address
 * confirms, and the member lands on a dead page. It cost a real signup to find.
 *
 * So this is checked by behaviour instead. Ask GoTrue to verify a token that
 * cannot be valid, with our own callback as `redirect_to`, and read the
 * `Location` header off the 302 without following it. The token is refused
 * either way — that is fine, and deliberately so. What the header reveals is
 * the *host* GoTrue chose, which is the setting we cannot otherwise read.
 *
 * The logic lives here rather than inline in `preflight.ts` so it can be tested
 * against each shape of answer without a network or a Supabase project, the
 * same reason `stripe-mode.ts` is a separate module.
 */

/** A token no real link will ever carry, so nothing can be consumed by accident. */
export const PROBE_TOKEN = 'preflight-probe-not-a-real-token';

export interface RedirectProbe {
  /** HTTP status from GoTrue. 0 means the request never completed. */
  status: number;
  /** The `Location` header, unfollowed. */
  location: string | null;
  /** Failure reason when `status` is 0. */
  reason?: string;
}

export type RedirectVerdict =
  /** `redirect_to` was honoured: confirmation will land on our callback. */
  | { kind: 'honoured'; origin: string }
  /**
   * GoTrue substituted its own Site URL. Confirmation lands somewhere that is
   * not ours — the failure this whole module exists to catch.
   */
  | { kind: 'substituted'; origin: string }
  /** A redirect was expected and none came, so the probe proves nothing. */
  | { kind: 'no-redirect'; status: number }
  /** The Location header is present but unparseable. */
  | { kind: 'unparseable'; location: string }
  /** Could not reach GoTrue. Never a pass. */
  | { kind: 'unreachable'; reason: string };

/**
 * Builds the probe URL for a project and the callback we expect to be honoured.
 */
export function probeUrl(supabaseUrl: string, callbackUrl: string): string {
  const url = new URL('/auth/v1/verify', supabaseUrl);
  url.searchParams.set('token', PROBE_TOKEN);
  url.searchParams.set('type', 'signup');
  url.searchParams.set('redirect_to', callbackUrl);
  return url.toString();
}

/**
 * Reads a verdict off the probe.
 *
 * Only the origin is compared. GoTrue appends its own query string to the
 * redirect — `error`, `error_code`, `error_description` for a token it refused
 * — and on success a fragment carrying the session. Comparing anything beyond
 * the origin would fail on a working configuration.
 */
export function redirectVerdict(
  probe: RedirectProbe,
  expectedCallbackUrl: string,
): RedirectVerdict {
  if (probe.status === 0) {
    return { kind: 'unreachable', reason: probe.reason ?? 'no response' };
  }

  if (!probe.location) {
    // A 4xx or 5xx with no Location means GoTrue rejected the request before
    // it got as far as choosing a destination, so the setting is still unknown.
    return { kind: 'no-redirect', status: probe.status };
  }

  let actual: URL;
  let expected: URL;
  try {
    // A relative Location is resolved against the expected origin, which is the
    // only base available. It cannot make a wrong answer look right: a relative
    // redirect means GoTrue did not name a host at all.
    actual = new URL(probe.location, expectedCallbackUrl);
    expected = new URL(expectedCallbackUrl);
  } catch {
    return { kind: 'unparseable', location: probe.location };
  }

  return actual.origin === expected.origin
    ? { kind: 'honoured', origin: actual.origin }
    : { kind: 'substituted', origin: actual.origin };
}

/**
 * The preflight row for a verdict: a status and a line explaining it.
 *
 * `substituted` is a **fail** rather than an `unknown`, because the probe did
 * see the answer and the answer is wrong. `no-redirect` and `unreachable` are
 * `unknown` — they mean this run could not decide, which under this script's
 * rules still counts as not ready.
 */
export function redirectCheckRow(verdict: RedirectVerdict): {
  status: 'pass' | 'fail' | 'unknown';
  detail: string;
} {
  switch (verdict.kind) {
    case 'honoured':
      return {
        status: 'pass',
        detail: `email confirmation returns to ${verdict.origin}`,
      };
    case 'substituted':
      return {
        status: 'fail',
        detail:
          `email confirmation goes to ${verdict.origin}, not this site — ` +
          'Supabase is ignoring redirect_to and using its own Site URL. ' +
          'Set Site URL and add the callback to Redirect URLs under ' +
          'Authentication → URL Configuration.',
      };
    case 'no-redirect':
      return {
        status: 'unknown',
        // Deliberately does not say *who* answered. Run from a sandbox whose
        // proxy refuses the Supabase host, this row read "GoTrue answered HTTP
        // 403" when GoTrue had never been reached — the same mistake as a
        // readiness check that reported a DNS timeout as a missing SPF record.
        // Something answered without a redirect; naming it would be a guess.
        detail:
          `HTTP ${verdict.status} with no Location header, so the redirect ` +
          'target was never disclosed — check whether anything between this ' +
          'host and Supabase Auth answered first',
      };
    case 'unparseable':
      return {
        status: 'unknown',
        detail: `could not parse the Location header: ${verdict.location}`,
      };
    case 'unreachable':
      return {
        status: 'unknown',
        detail: `could not reach Supabase Auth: ${verdict.reason}`,
      };
  }
}
