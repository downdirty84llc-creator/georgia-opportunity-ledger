/**
 * What to tell somebody who arrives at `/auth/callback` and does not get a
 * session.
 *
 * Three faults met here, all of which sent the member to a bare `/login` with
 * nothing said:
 *
 *   1. The route read only `code`. GoTrue signals a refused link with
 *      `?error=access_denied&error_code=otp_expired`, which fell into the
 *      no-code branch and was discarded.
 *   2. `login-form.tsx` read `next` from the query string and never `error`,
 *      so even the one signal the route did emit was dropped on the floor.
 *   3. A failed code exchange was reported as `link_expired`. Expiry is one
 *      cause; the ordinary one is opening the email in a different browser
 *      from the one that registered, where the PKCE verifier cookie does not
 *      exist. Naming the wrong cause is the same defect as a missing Stripe
 *      key reported as a bad signature — see CLAUDE.md.
 *
 * The notice is a **closed set**, deliberately. `error_description` arrives
 * from outside and must never be rendered: reflecting attacker-chosen text
 * onto our own sign-in page is how a phishing message ends up wearing our
 * styling. The raw reason belongs in the server log, and the member sees copy
 * we wrote.
 */

export const CALLBACK_NOTICES = {
  /** GoTrue refused the link: expired, already used, or otherwise rejected. */
  link_error:
    'That confirmation link could not be used — it may have expired or ' +
    'already been used. Sign in below, or ask for a new sign-in link.',
  /**
   * The link was accepted but the session could not be established here.
   * Deliberately does not claim the link expired, because usually it has not.
   */
  signin_required:
    'We could not finish signing you in from that link. If you opened it in ' +
    'a different browser from the one you signed up in, sign in below instead.',
} as const;

export type CallbackNotice = keyof typeof CALLBACK_NOTICES;

/**
 * The notice for a callback that carried an error, or `null` when it did not.
 *
 * GoTrue uses `error` and `error_code`; some flows send only
 * `error_description`. Any of them means the link was refused.
 */
export function noticeForCallbackError(
  params: URLSearchParams,
): CallbackNotice | null {
  const signalled =
    params.get('error') ??
    params.get('error_code') ??
    params.get('error_description');
  return signalled ? 'link_error' : null;
}

/**
 * Resolves a `notice` query value to copy, or `null` for anything unrecognised.
 *
 * The closed-set lookup is the guard: `?notice=<anything else>` renders
 * nothing rather than rendering itself.
 */
export function callbackNoticeMessage(value: string | null): string | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(CALLBACK_NOTICES, value)
    ? CALLBACK_NOTICES[value as CallbackNotice]
    : null;
}

/**
 * An internal destination only. A `next` that names another origin — or uses
 * `//host` to mean one — falls back to the dashboard.
 */
export function safeNextPath(next: string | null): string {
  if (!next) return '/dashboard';
  if (!next.startsWith('/')) return '/dashboard';
  if (next.startsWith('//')) return '/dashboard';
  // `/\` is read as a scheme-relative URL by some clients.
  if (next.startsWith('/\\')) return '/dashboard';
  return next;
}
