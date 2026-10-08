import { describe, expect, it } from 'vitest';

import {
  CALLBACK_NOTICES,
  callbackNoticeMessage,
  noticeForCallbackError,
  noticeForCallbackHash,
  safeNextPath,
} from '@/lib/auth/callback-notice';

/**
 * `/auth/callback` used to forward no reason at all. A refused confirmation
 * link, a failed code exchange and somebody simply opening the URL all ended on
 * the same unexplained sign-in page — and `login-form.tsx` read `next` from the
 * query string but never `error`, so the one signal the route did emit was
 * discarded anyway.
 *
 * The test that matters most here is the reflection guard. The notice is a
 * closed set precisely so that `?notice=<anything>` cannot put attacker-chosen
 * text on our own sign-in page wearing our own styling.
 */

const params = (query: string) => new URLSearchParams(query);

describe('noticeForCallbackError', () => {
  it('detects the error GoTrue sends for a refused link', () => {
    // The real shape: an error arrives *instead* of a code.
    expect(
      noticeForCallbackError(
        params('error=access_denied&error_code=otp_expired'),
      ),
    ).toBe('link_error');
  });

  it.each([
    'error=access_denied',
    'error_code=otp_expired',
    'error_description=Email+link+is+invalid+or+has+expired',
  ])('detects it from %s alone', (query) => {
    // Not every flow sends all three, so any one of them must count.
    expect(noticeForCallbackError(params(query))).toBe('link_error');
  });

  it('returns null for a callback carrying a code', () => {
    expect(noticeForCallbackError(params('code=abc123'))).toBeNull();
  });

  it('returns null for an empty query, so a bare visit is not an error', () => {
    expect(noticeForCallbackError(params(''))).toBeNull();
  });
});

describe('noticeForCallbackHash', () => {
  it('reads the error GoTrue actually sends, which is in the fragment', () => {
    // Copied from the live project the day Site URL was corrected. This is the
    // real shape, and the reason the server-side check alone was useless: a
    // fragment never reaches the server, so the route saw neither a code nor
    // an error and sent the member to an unexplained page.
    const observed =
      '#error=access_denied&error_code=otp_expired' +
      '&error_description=Email+link+is+invalid+or+has+expired&sb=';

    expect(noticeForCallbackHash(observed)).toBe('link_error');
  });

  it('works with or without the leading hash', () => {
    expect(noticeForCallbackHash('#error=access_denied')).toBe('link_error');
    expect(noticeForCallbackHash('error=access_denied')).toBe('link_error');
  });

  it('returns null for an empty or absent fragment', () => {
    // The ordinary case: somebody opening /login directly must see nothing.
    for (const hash of ['', '#']) {
      expect(noticeForCallbackHash(hash)).toBeNull();
    }
  });

  it('returns null for a fragment carrying no error', () => {
    // A successful implicit-flow confirmation puts tokens here, not an error.
    // It must not be reported as a failure.
    expect(
      noticeForCallbackHash('#access_token=abc&refresh_token=def&type=signup'),
    ).toBeNull();
  });
});

describe('callbackNoticeMessage', () => {
  it('resolves each notice in the set', () => {
    for (const key of Object.keys(CALLBACK_NOTICES)) {
      expect(callbackNoticeMessage(key)).toBe(
        CALLBACK_NOTICES[key as keyof typeof CALLBACK_NOTICES],
      );
    }
  });

  it('never reflects an unrecognised value back to the page', () => {
    // The guard. Rendering the query string would let anyone put their own
    // words on our sign-in page, under our styling — a phishing message with
    // our branding is worse than no message.
    for (const value of [
      'Your account is suspended. Call 555-0100 to reinstate it.',
      '<script>alert(1)</script>',
      'link_error ',
      'LINK_ERROR',
      'unknown',
      '',
    ]) {
      expect(callbackNoticeMessage(value)).toBeNull();
    }
  });

  it('is not fooled by inherited object properties', () => {
    // A plain `CALLBACK_NOTICES[value]` lookup would return Object.prototype
    // members, so `?notice=constructor` would render a function body.
    for (const value of [
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
    ]) {
      expect(callbackNoticeMessage(value)).toBeNull();
    }
  });

  it('returns null for an absent parameter', () => {
    expect(callbackNoticeMessage(null)).toBeNull();
  });

  it('does not claim the link expired when the session could not be made', () => {
    // The distinction this repair turns on: a failed code exchange is usually
    // the email being opened in a different browser, not an expired link.
    // Calling it expiry sends the member to request a new link, which will
    // fail the same way.
    expect(callbackNoticeMessage('signin_required')).not.toMatch(/expired/i);
    expect(callbackNoticeMessage('signin_required')).toMatch(
      /different browser/i,
    );
  });
});

describe('safeNextPath', () => {
  it('keeps an internal path', () => {
    expect(safeNextPath('/saved')).toBe('/saved');
    expect(safeNextPath('/opportunities?county=fulton')).toBe(
      '/opportunities?county=fulton',
    );
  });

  it('falls back to the dashboard when absent', () => {
    expect(safeNextPath(null)).toBe('/dashboard');
    expect(safeNextPath('')).toBe('/dashboard');
  });

  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    '/\\evil.example/phish',
    'javascript:alert(1)',
  ])('refuses %s', (next) => {
    // An open redirect on a sign-in page hands somebody a link that starts on
    // our domain and ends on theirs, with the member already trusting it.
    expect(safeNextPath(next)).toBe('/dashboard');
  });
});
