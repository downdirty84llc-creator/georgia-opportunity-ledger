'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

export function CorrectionForm() {
  const searchParams = useSearchParams();
  const opportunityId = searchParams.get('opportunity');
  const reportId = searchParams.get('report');

  const [description, setDescription] = useState('');
  const [supportingUrl, setSupportingUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>(
    'idle',
  );
  const [feedback, setFeedback] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus('sending');
    setFeedback('');
    try {
      const response = await fetch('/api/v1/corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opportunityId: opportunityId ?? undefined,
          reportId: reportId ?? undefined,
          description,
          supportingUrl: supportingUrl || undefined,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setStatus('error');
        setFeedback(
          payload?.error?.message ??
            'The correction could not be submitted. Try again.',
        );
        return;
      }
      setStatus('sent');
      setFeedback(
        'Thank you. A reviewer will check this against the source, and material corrections are published.',
      );
    } catch {
      setStatus('error');
      setFeedback('The correction could not be submitted. Try again.');
    }
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
      {opportunityId || reportId ? (
        <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
          This correction will be attached to the{' '}
          {opportunityId ? 'record' : 'report'} you came from.
        </p>
      ) : null}

      <div>
        <label htmlFor="description" className="block text-sm font-medium">
          What is wrong, and what should it say?
        </label>
        <textarea
          id="description"
          required
          rows={6}
          minLength={20}
          maxLength={8000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label htmlFor="supportingUrl" className="block text-sm font-medium">
          Source that supports the correction{' '}
          <span className="font-normal text-ink-500">(optional)</span>
        </label>
        <input
          id="supportingUrl"
          type="url"
          placeholder="https://"
          value={supportingUrl}
          onChange={(event) => setSupportingUrl(event.target.value)}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
        />
      </div>

      {status === 'error' ? (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {feedback}
        </p>
      ) : null}

      <Button type="submit" disabled={status === 'sending'}>
        {status === 'sending' ? 'Submitting…' : 'Submit correction'}
      </Button>
    </form>
  );
}
