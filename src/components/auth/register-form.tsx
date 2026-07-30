'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

export function RegisterForm() {
  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    companyName: '',
    acceptedTerms: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [done, setDone] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setIsError(false);

    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setIsError(true);
        const issues = payload?.error?.details?.issues as
          | Array<{ message: string }>
          | undefined;
        setMessage(
          issues?.map((issue) => issue.message).join(' ') ??
            payload?.error?.message ??
            'Registration failed. Try again.',
        );
        return;
      }

      setDone(true);
      setMessage(
        payload?.data?.message ??
          'Check your email to confirm your address and finish setting up your account.',
      );
    } catch {
      setIsError(true);
      setMessage('Registration failed. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="surface p-6">
        <h2 className="text-lg font-semibold">One more step</h2>
        <p role="status" className="mt-2 text-sm text-ink-700">
          {message}
        </p>
        <p className="mt-4 text-sm text-ink-600">
          Once your address is confirmed you can{' '}
          <Link href="/login" className="font-medium underline">
            log in
          </Link>{' '}
          and, if you want more than the free preview,{' '}
          <Link href="/pricing" className="font-medium underline">
            choose a plan
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="surface space-y-5 p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium">
            First name
          </label>
          <input
            id="firstName"
            autoComplete="given-name"
            value={form.firstName}
            onChange={(event) => update('firstName', event.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium">
            Last name
          </label>
          <input
            id="lastName"
            autoComplete="family-name"
            value={form.lastName}
            onChange={(event) => update('lastName', event.target.value)}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="companyName" className="block text-sm font-medium">
          Company <span className="font-normal text-ink-400">(optional)</span>
        </label>
        <input
          id="companyName"
          autoComplete="organization"
          value={form.companyName}
          onChange={(event) => update('companyName', event.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
        />
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
          value={form.email}
          onChange={(event) => update('email', event.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          aria-describedby="password-hint"
          value={form.password}
          onChange={(event) => update('password', event.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
        />
        <p id="password-hint" className="mt-1 text-xs text-ink-500">
          At least 12 characters. A short sentence works well.
        </p>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          required
          checked={form.acceptedTerms}
          onChange={(event) => update('acceptedTerms', event.target.checked)}
          className="mt-0.5 rounded border-ink-300"
        />
        <span>
          I accept the{' '}
          <Link href="/legal/terms" className="underline">
            terms of service
          </Link>{' '}
          and the{' '}
          <Link href="/legal/privacy" className="underline">
            privacy policy
          </Link>
          .
        </span>
      </label>

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
        {busy ? 'Creating your account…' : 'Create my free account'}
      </Button>

      <p className="text-center text-sm text-ink-600">
        Already a member?{' '}
        <Link href="/login" className="font-medium underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
