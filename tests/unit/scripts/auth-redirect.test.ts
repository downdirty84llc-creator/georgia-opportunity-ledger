import { describe, expect, it } from 'vitest';

import {
  PROBE_TOKEN,
  probeUrl,
  redirectCheckRow,
  redirectVerdict,
} from '../../../scripts/auth-redirect';

/**
 * These exist because the fault they catch was invisible from inside the
 * application. A signup against a project whose Site URL still said
 * `http://localhost:3000` created the account, sent the mail and confirmed the
 * address — every step reported success — and then dropped the member on a
 * page that could not load. Nothing in the repository could see the setting.
 *
 * So the important test here is not that a correct configuration passes. It is
 * that a *substituted* host is a **fail** and not an `unknown`, because an
 * `unknown` in this script means "could not look" and would have read as the
 * same not-yet-checked row it had always been.
 */

const CALLBACK = 'https://georgiaopportunityledger.com/auth/callback';

describe('probeUrl', () => {
  it('asks GoTrue to verify, carrying our callback as redirect_to', () => {
    const url = new URL(probeUrl('https://ref.supabase.co', CALLBACK));

    expect(url.origin).toBe('https://ref.supabase.co');
    expect(url.pathname).toBe('/auth/v1/verify');
    expect(url.searchParams.get('type')).toBe('signup');
    expect(url.searchParams.get('redirect_to')).toBe(CALLBACK);
  });

  it('carries a token that cannot belong to a real link', () => {
    // The probe runs against production. If this were ever a plausible token
    // the check would be consuming somebody's confirmation link to run itself.
    const token = new URL(
      probeUrl('https://ref.supabase.co', CALLBACK),
    ).searchParams.get('token');

    expect(token).toBe(PROBE_TOKEN);
    expect(token).toMatch(/probe/);
  });

  it('keeps the project path when the Supabase URL carries one', () => {
    const url = new URL(probeUrl('https://gateway.example/sb', CALLBACK));

    expect(url.pathname).toBe('/auth/v1/verify');
  });
});

describe('redirectVerdict', () => {
  it('reads a redirect back to our own origin as honoured', () => {
    // GoTrue appends its own error parameters for a token it refused. The
    // probe deliberately sends an invalid one, so this is the shape a healthy
    // project answers with — comparing more than the origin would fail here.
    const verdict = redirectVerdict(
      {
        status: 302,
        location:
          'https://georgiaopportunityledger.com/auth/callback' +
          '?error=access_denied&error_code=otp_expired',
      },
      CALLBACK,
    );

    expect(verdict).toEqual({
      kind: 'honoured',
      origin: 'https://georgiaopportunityledger.com',
    });
  });

  it('reads the localhost fallback as substituted', () => {
    // The actual production fault, as observed.
    const verdict = redirectVerdict(
      { status: 302, location: 'http://localhost:3000/?error=access_denied' },
      CALLBACK,
    );

    expect(verdict).toEqual({
      kind: 'substituted',
      origin: 'http://localhost:3000',
    });
  });

  it('reads any other host as substituted, not just localhost', () => {
    // A stale Site URL pointing at the vercel.app host, or at the domain we do
    // not control, is the same defect and must not slip through a localhost
    // special case.
    for (const location of [
      'https://georgia-opportunity-ledger.vercel.app/auth/callback',
      'https://gaopportunityledger.com/auth/callback',
    ]) {
      expect(redirectVerdict({ status: 302, location }, CALLBACK).kind).toBe(
        'substituted',
      );
    }
  });

  it('treats a scheme change on the same host as substituted', () => {
    // http:// against an https:// site is a different origin and a real
    // problem: the session fragment would travel in clear text.
    const verdict = redirectVerdict(
      {
        status: 302,
        location: 'http://georgiaopportunityledger.com/auth/callback',
      },
      CALLBACK,
    );

    expect(verdict.kind).toBe('substituted');
  });

  it('does not let a relative Location pass as honoured by accident', () => {
    // Resolved against the expected origin it would compare equal, so this is
    // the one case where the comparison could flatter a broken answer.
    const verdict = redirectVerdict(
      { status: 302, location: '/auth/callback?error=access_denied' },
      CALLBACK,
    );

    // It resolves to our origin, which is the honest reading: a relative
    // redirect names no other host, so confirmation does land here.
    expect(verdict.kind).toBe('honoured');
  });

  it('reports no-redirect when GoTrue answers without a Location', () => {
    const verdict = redirectVerdict({ status: 400, location: null }, CALLBACK);

    expect(verdict).toEqual({ kind: 'no-redirect', status: 400 });
  });

  it('reports unreachable when the request never completed', () => {
    const verdict = redirectVerdict(
      { status: 0, location: null, reason: 'fetch failed' },
      CALLBACK,
    );

    expect(verdict).toEqual({ kind: 'unreachable', reason: 'fetch failed' });
  });

  it('reports unparseable rather than guessing at a malformed header', () => {
    const verdict = redirectVerdict(
      { status: 302, location: 'http://' },
      CALLBACK,
    );

    expect(verdict.kind).toBe('unparseable');
  });
});

describe('redirectCheckRow', () => {
  it('fails on a substituted host rather than calling it unknown', () => {
    // The distinction this check turns on. `unknown` means "could not look",
    // and this run did look.
    const row = redirectCheckRow({
      kind: 'substituted',
      origin: 'http://localhost:3000',
    });

    expect(row.status).toBe('fail');
    expect(row.detail).toContain('http://localhost:3000');
  });

  it('names the setting and where to change it', () => {
    // A failure nobody can act on gets ignored. The row has to say which
    // screen fixes it, because no diff ever will.
    const row = redirectCheckRow({
      kind: 'substituted',
      origin: 'http://localhost:3000',
    });

    expect(row.detail).toMatch(/Site URL/);
    expect(row.detail).toMatch(/Redirect URLs/);
    expect(row.detail).toMatch(/URL Configuration/);
  });

  it('does not claim who answered when no redirect came back', () => {
    // Run from a sandbox whose proxy refuses the Supabase host, this row once
    // read "GoTrue answered HTTP 403" — GoTrue had never been reached. Naming a
    // responder the probe cannot identify is how a readiness check ends up
    // reporting the wrong fault, which this repository has done before.
    const row = redirectCheckRow({ kind: 'no-redirect', status: 403 });

    expect(row.status).toBe('unknown');
    expect(row.detail).toContain('403');
    expect(row.detail).not.toMatch(/GoTrue answered|Supabase answered/);
  });

  it('passes only when the callback origin was honoured', () => {
    const row = redirectCheckRow({
      kind: 'honoured',
      origin: 'https://georgiaopportunityledger.com',
    });

    expect(row.status).toBe('pass');
  });

  it.each([
    { kind: 'no-redirect', status: 500 } as const,
    { kind: 'unreachable', reason: 'timeout' } as const,
    { kind: 'unparseable', location: 'http://' } as const,
  ])('reports $kind as unknown, never as pass', (verdict) => {
    // Under this script's rules `unknown` still counts as not ready, which is
    // the correct reading of a probe that could not decide.
    expect(redirectCheckRow(verdict).status).toBe('unknown');
  });
});
