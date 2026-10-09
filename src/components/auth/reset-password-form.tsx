'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/primitives';
import { noticeForCallbackHash } from '@/lib/auth/callback-notice';

type Mode = 'checking' | 'request' | 'set';

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const notice = searchParams.get('notice');
  const [mode, setMode] = useState<Mode>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // The callback establishes a session in HttpOnly cookies. Ask the server
  // about that session; a browser Supabase client cannot read those cookies.
  useEffect(() => {
    let cancelled = false;

    async function detect() {
      const refusedLink = noticeForCallbackHash(window.location.hash);
      if (
        refusedLink ||
        notice === 'link_error' ||
        notice === 'signin_required'
      ) {
        setMode('request');
        setIsError(true);
        setMessage(
          notice === 'signin_required'
            ? 'We could not open this reset link here. Request a new link and open it in the same browser.'
            : 'That password reset link could not be used. Request a new link below.',
        );
        return;
      }

      try {
        const response = await fetch('/api/v1/auth/session', {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('Session check failed');
        const payload = await response.json();
        if (!cancelled)
          setMode(payload?.data?.authenticated === true ? 'set' : 'request');
      } catch {
        if (!cancelled) {
          setMode('request');
          setIsError(true);
          setMessage(
            'We could not check your session. Reload this page and try again.',
          );
        }
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, [notice]);

  async function requestLink(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch('/api/v1/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setIsError(true);
        setMessage(
          payload?.error?.message ??
            'The reset request could not be completed. Please try again.',
        );
        return;
      }

      // The endpoint answers identically whether or not the address exists, and
      // so does this page.
      setMessage(
        payload?.data?.message ??
          'If that address has an account, a password reset link is on its way.',
      );
    } catch {
      setIsError(true);
      setMessage('Something went wrong. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function setNewPassword(event: React.FormEvent) {
    event.preventDefault();

    if (password !== confirmation) {
      setIsError(true);
      setMessage('Those two passwords do not match.');
      return;
    }
    if (password.length < 12 || password.length > 200) {
      setIsError(true);
      setMessage('Use between 12 and 200 characters.');
      return;
    }

    setBusy(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch('/api/v1/auth/password-reset', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setIsError(true);
        setMessage(
          payload?.error?.message ??
            'Your password could not be changed. Request a fresh link.',
        );
        if (response.status === 401) setMode('request');
        return;
      }

      setMessage('Password changed. Taking you to your dashboard…');
      router.push('/dashboard');
      router.refresh();
    } catch {
      setIsError(true);
      setMessage('Your password could not be changed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'checking') {
    return (
      <p className="surface px-5 py-6 text-sm text-ink-600">
        Checking your link…
      </p>
    );
  }

  if (mode === 'set') {
    return (
      <>
        <h1 className="text-2xl sm:text-3xl">Choose a new password</h1>
        <p className="mt-2 text-sm text-ink-600">
          Pick something you have not used elsewhere. A short sentence works
          well and is easier to remember than a mangled word.
        </p>

        <form onSubmit={setNewPassword} className="surface mt-8 space-y-5 p-6">
          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={200}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label htmlFor="confirmation" className="block text-sm font-medium">
              Confirm new password
            </label>
            <input
              id="confirmation"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={200}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
            />
          </div>

          {message ? (
            <p
              role={isError ? 'alert' : 'status'}
              className={
                isError
                  ? 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900'
                  : 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
              }
            >
              {message}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? 'Saving…' : 'Change my password'}
          </Button>
        </form>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl sm:text-3xl">Reset your password</h1>
      <p className="mt-2 text-sm text-ink-600">
        Tell us your address and we will email you a link to set a new password.
      </p>

      <form onSubmit={requestLink} className="surface mt-8 space-y-5 p-6">
        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
          />
        </div>

        {message ? (
          <p
            role={isError ? 'alert' : 'status'}
            className={
              isError
                ? 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900'
                : 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900'
            }
          >
            {message}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Sending…' : 'Email me a reset link'}
        </Button>

        <p className="text-center text-sm text-ink-600">
          Remembered it?{' '}
          <Link href="/login" className="font-medium underline">
            Log in
          </Link>
        </p>
      </form>
    </>
  );
}
