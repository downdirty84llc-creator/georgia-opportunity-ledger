'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';
import { REQUEST_CONFIG, type RequestKind } from '@/lib/admin/member-requests';

export function MemberRequestForm({
  kind,
  id,
  status,
  updatedAt,
  note,
}: {
  kind: RequestKind;
  id: string;
  status: string;
  updatedAt: string;
  note: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  if (saved)
    return (
      <p role="status" className="mt-4">
        Review saved. The queue is refreshing.
      </p>
    );
  return (
    <form
      className="mt-5 space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setBusy(true);
        setError('');
        try {
          const response = await fetch('/api/v1/admin/member-requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind,
              id,
              expectedUpdatedAt: updatedAt,
              status: form.get('status'),
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
        Status
        <select
          name="status"
          defaultValue={status}
          required
          disabled={busy}
          className="mt-1 block w-full rounded-md border border-ink-300 p-2"
        >
          {REQUEST_CONFIG[kind].statuses.map((value) => (
            <option key={value} value={value}>
              {value.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm font-medium">
        Review and resolution note
        <textarea
          name="note"
          defaultValue={note ?? ''}
          required
          minLength={10}
          maxLength={8000}
          rows={3}
          disabled={busy}
          className="mt-1 block w-full rounded-md border border-ink-300 p-2"
        />
      </label>
      <p className="text-sm text-ink-600">
        Write a note safe for the requester to read. Saving records your review
        and assigns it to you. It does not send an email
        {kind === 'corrections'
          ? ' or edit the linked record. Publish the actual correction before marking this request published'
          : ''}
        .
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save review'}
      </Button>
    </form>
  );
}
