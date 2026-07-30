'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

const CATEGORIES = [
  ['account', 'Account (including appeals)'],
  ['billing', 'Billing'],
  ['technical', 'Something is broken'],
  ['content_question', 'Question about a record'],
  ['privacy_request', 'Data export or deletion'],
  ['accessibility', 'Accessibility'],
  ['other', 'Something else'],
] as const;

export function SupportForm({
  isAuthenticated,
  isSuspended,
}: {
  isAuthenticated: boolean;
  isSuspended: boolean;
}) {
  const searchParams = useSearchParams();
  const topic = searchParams.get('topic');
  const [category, setCategory] = useState(
    topic === 'data_export' || topic === 'account_deletion'
      ? 'privacy_request'
      : isSuspended
        ? 'account'
        : 'account',
  );
  const [subject, setSubject] = useState(
    topic === 'data_export'
      ? 'Data export request'
      : topic === 'account_deletion'
        ? 'Account deletion request'
        : '',
  );
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  );
  const [feedback, setFeedback] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');
    setFeedback('');
    try {
      const response = await fetch('/api/v1/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, subject, message }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatus('error');
        setFeedback(
          payload?.error?.message ?? 'Your message could not be sent. Try again.',
        );
        return;
      }
      setStatus('sent');
      setFeedback(
        'Received. We reply by email, usually within one business day.',
      );
    } catch {
      setStatus('error');
      setFeedback('Your message could not be sent. Try again.');
    }
  }

  if (!isAuthenticated) {
    return (
      <p className="surface px-5 py-6 text-sm text-ink-700">
        Sign in to open a support ticket, so we can see your account and reply
        to the right address.{' '}
        <a href="/login?next=/support" className="font-medium underline">
          Log in
        </a>
      </p>
    );
  }

  if (status === 'sent') {
    return (
      <p role="status" className="surface px-5 py-6 text-sm text-emerald-900">
        {feedback}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="surface space-y-5 p-6">
      <div>
        <label htmlFor="category" className="block text-sm font-medium">
          What is this about?
        </label>
        <select
          id="category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
        >
          {CATEGORIES.filter(([value]) => !isSuspended || value === 'account').map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ),
          )}
        </select>
      </div>

      <div>
        <label htmlFor="subject" className="block text-sm font-medium">
          Subject
        </label>
        <input
          id="subject"
          required
          maxLength={200}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium">
          Message
        </label>
        <textarea
          id="message"
          required
          rows={6}
          maxLength={8000}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
        />
      </div>

      {status === 'error' ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
          {feedback}
        </p>
      ) : null}

      <Button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  );
}
