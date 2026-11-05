'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';

export function BillingReviewForm({ eventId }: { eventId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  if (saved)
    return (
      <p role="status" className="mt-4 text-sm">
        Review saved in the audit log.
      </p>
    );
  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setError('');
        try {
          const response = await fetch('/api/v1/admin/billing-review', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              eventId,
              outcome: form.get('outcome'),
              note: form.get('note'),
            }),
          });
          const body = await response.json();
          if (!response.ok)
            throw new Error(body.error?.message ?? 'Could not save review.');
          setSaved(true);
          router.refresh();
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : 'Could not save review.',
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="block text-sm font-medium">
        Review outcome
        <select
          name="outcome"
          required
          disabled={busy}
          defaultValue=""
          className="mt-1 block w-full rounded-md border border-ink-300 p-2"
        >
          <option value="" disabled>
            Select an outcome
          </option>
          <option value="no_change">No account change needed</option>
          <option value="handled_in_stripe">Handled in Stripe</option>
        </select>
      </label>
      <label className="block text-sm font-medium">
        Decision and follow-up details
        <textarea
          name="note"
          required
          minLength={10}
          maxLength={2000}
          rows={3}
          disabled={busy}
          className="mt-1 block w-full rounded-md border border-ink-300 p-2"
        />
      </label>
      <p className="text-sm text-ink-600">
        Record what you checked and any action already taken. This saves an
        audit entry; it does not issue a refund, respond to a dispute or change
        access.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Record completed review'}
      </Button>
    </form>
  );
}
