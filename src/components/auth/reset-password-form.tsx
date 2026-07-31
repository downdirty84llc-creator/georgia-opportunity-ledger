'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/primitives';
import { createBrowserSupabaseClient } from '@/lib/db/browser';

type Mode = 'checking' | 'request' | 'set';

export function ResetPasswordForm() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  // A recovery link puts a session in place before this page renders. Its
  // presence is what distinguishes "set a new password" from "send me a link".
  useEffect(() => {
    let cancelled = false;

    async function detect() {
      try {
        const supabase = createBrowserSupabaseClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!cancelled) setMode(session ? 'set' : 'request');
      } catch {
        if (!cancelled) setMode('request');
      }
    }

    void detect();
    return () => {
      cancelled = true;
    };
  }, []);

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

      if (response.status === 429) {
        setIsError(true);
        setMessage(
          payload?.error?.message ??
            'Too many attempts. Wait a few minutes and try again.',
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
    if (password.length < 12) {
      setIsError(true);
      setMessage('Use at least 12 characters.');
      return;
    }

    setBusy(true);
    setMessage(null);
    setIsError(false);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setIsError(true);
        setMessage(
          error.message.includes('expired')
            ? 'That reset link has expired. Request a fresh one.'
            : 'Your password could not be changed. Request a fresh link.',
        );
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
