'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Card } from '@/components/ui/primitives';
import { createBrowserSupabaseClient } from '@/lib/db/browser';
import { titleCase } from '@/lib/format';
import type { MfaState } from '@/lib/auth/mfa';

/**
 * Enrolment and challenge, on one page.
 *
 * Which half renders is decided by the server from the session's assurance
 * level, so a staff member who is enrolled but has not presented their factor
 * this session lands directly on the code prompt rather than being offered a
 * second enrolment they do not need.
 */
export function MfaSetup({
  state,
  factorId,
  role,
}: {
  state: MfaState;
  factorId: string | null;
  role: string;
}) {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [enrolFactorId, setEnrolFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function beginEnrolment() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data, error: enrolError } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Ledger admin — ${titleCase(role)}`,
      });

      if (enrolError || !data) {
        setError(
          enrolError?.message ?? 'Enrolment could not be started. Try again.',
        );
        return;
      }

      setEnrolFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    } catch {
      setError('Enrolment could not be started. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(targetFactorId: string) {
    setBusy(true);
    setError(null);
    try {
      const supabase = createBrowserSupabaseClient();

      const { data: challenge, error: challengeError } =
        await supabase.auth.mfa.challenge({ factorId: targetFactorId });

      if (challengeError || !challenge) {
        setError(challengeError?.message ?? 'Could not start the challenge.');
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: targetFactorId,
        challengeId: challenge.id,
        code: code.replace(/\s/g, ''),
      });

      if (verifyError) {
        setError(
          verifyError.message.toLowerCase().includes('invalid')
            ? 'That code was not accepted. Codes expire after 30 seconds — try the next one.'
            : verifyError.message,
        );
        return;
      }

      router.push('/admin');
      router.refresh();
    } catch {
      setError('Verification failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'satisfied') {
    return (
      <Card>
        <h2 className="text-base font-semibold text-emerald-900">
          Two-factor authentication is active
        </h2>
        <p className="mt-2 text-sm text-ink-700">
          This session has presented your second factor. Nothing further is
          needed.
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => router.push('/admin')}
        >
          Go to the admin dashboard
        </Button>
      </Card>
    );
  }

  if (state === 'challenge_required' && factorId) {
    return (
      <Card>
        <h2 className="text-base font-semibold">Enter your code</h2>
        <p className="mt-2 text-sm text-ink-700">
          You are enrolled, but this session has not presented your second
          factor yet. Open your authenticator app and enter the current
          six-digit code.
        </p>

        <label htmlFor="mfa-code" className="mt-4 block text-sm font-medium">
          Six-digit code
        </label>
        <input
          id="mfa-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="mt-1 w-40 rounded-lg border border-ink-300 px-3 py-2 font-mono text-lg tracking-widest"
        />

        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}

        <Button
          className="mt-4"
          disabled={busy || code.length < 6}
          onClick={() => verify(factorId)}
        >
          {busy ? 'Verifying…' : 'Verify and continue'}
        </Button>
      </Card>
    );
  }

  // Enrolment required.
  return (
    <Card>
      <h2 className="text-base font-semibold">Set up your authenticator</h2>

      {!qr ? (
        <>
          <p className="mt-2 text-sm text-ink-700">
            You will need an authenticator app — 1Password, Authy, Google
            Authenticator or your password manager&rsquo;s built-in one. This
            takes about a minute and only has to be done once.
          </p>
          {error ? (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          <Button className="mt-4" disabled={busy} onClick={beginEnrolment}>
            {busy ? 'Starting…' : 'Start enrolment'}
          </Button>
        </>
      ) : (
        <>
          <ol className="mt-3 space-y-4 text-sm text-ink-700">
            <li>
              <strong className="font-semibold">1. Scan this code</strong> with
              your authenticator app.
              <div className="mt-2 inline-block rounded-lg border border-ink-200 bg-white p-3">
                {/* Supabase returns the QR as an inline SVG data URL. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt="QR code for enrolling this account in two-factor authentication"
                  width={180}
                  height={180}
                />
              </div>
            </li>
            <li>
              <strong className="font-semibold">Cannot scan?</strong> Enter this
              key manually:
              <code className="mt-1 block break-all rounded bg-ink-50 px-2 py-1 font-mono text-xs">
                {secret}
              </code>
            </li>
            <li>
              <strong className="font-semibold">
                2. Enter the six-digit code
              </strong>{' '}
              your app now shows.
              <div className="mt-2">
                <label htmlFor="enrol-code" className="sr-only">
                  Six-digit code
                </label>
                <input
                  id="enrol-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="w-40 rounded-lg border border-ink-300 px-3 py-2 font-mono text-lg tracking-widest"
                />
              </div>
            </li>
          </ol>

          {error ? (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          <Button
            className="mt-4"
            disabled={busy || code.length < 6 || !enrolFactorId}
            onClick={() => enrolFactorId && verify(enrolFactorId)}
          >
            {busy ? 'Verifying…' : 'Confirm and finish'}
          </Button>

          <p className="mt-4 text-xs text-ink-500">
            Store the manual key somewhere safe. It is the only way to move your
            second factor to a new device without a super administrator
            resetting it for you.
          </p>
        </>
      )}
    </Card>
  );
}
