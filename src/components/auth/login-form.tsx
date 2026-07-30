'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [method, setMethod] = useState<'password' | 'magic_link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          method === 'password'
            ? { method, email, password }
            : { method, email },
        ),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setIsError(true);
        setMessage(payload?.error?.message ?? 'Sign-in failed. Try again.');
        return;
      }

      if (method === 'magic_link') {
        setMessage(
          payload?.data?.message ??
            'If that address has an account, a sign-in link is on its way.',
        );
        return;
      }

      // The `next` parameter only ever navigates within this site.
      const next = searchParams.get('next');
      const destination =
        next && next.startsWith('/') && !next.startsWith('//')
          ? next
          : '/dashboard';
      router.push(destination);
      router.refresh();
    } catch {
      setIsError(true);
      setMessage('Sign-in failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface space-y-5 p-6">
      <div
        role="group"
        aria-label="Sign-in method"
        className="inline-flex rounded-lg border border-ink-300 bg-white p-1"
      >
        {(
          [
            ['password', 'Password'],
            ['magic_link', 'Email me a link'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMethod(value)}
            aria-pressed={method === value}
            className={
              method === value
                ? 'rounded-md bg-ink-900 px-3 py-1.5 text-sm font-medium text-white'
                : 'rounded-md px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-ink-100'
            }
          >
            {label}
          </button>
        ))}
      </div>

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

      {method === 'password' ? (
        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
          />
          <Link
            href="/auth/reset-password"
            className="mt-1.5 inline-block text-xs text-ink-600 underline"
          >
            Forgotten your password?
          </Link>
        </div>
      ) : null}

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
        {busy
          ? 'Working…'
          : method === 'password'
            ? 'Log in'
            : 'Send me a sign-in link'}
      </Button>

      <p className="text-center text-sm text-ink-600">
        New here?{' '}
        <Link href="/register" className="font-medium underline">
          Create a free account
        </Link>
      </p>
    </form>
  );
}
