'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

/**
 * The two controls the Privacy Policy offers that used to be links to a
 * support form: a subject-access export, and account deletion.
 *
 * Deletion asks for typed confirmation rather than a second "are you sure"
 * dialog. A confirm step trains people to click through it; typing the word
 * requires reading the sentence above it, which is where the consequences are.
 */
export function PrivacyControls({
  deletionRequestedAt,
  daysRemaining,
}: {
  deletionRequestedAt: string | null;
  daysRemaining: number;
}) {
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState<'export' | 'delete' | 'cancel' | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function downloadExport() {
    setPending('export');
    setError(null);
    try {
      const response = await fetch('/api/v1/account/data-export');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? 'The export could not be produced.');
        return;
      }
      // Streamed straight to a file rather than rendered: it is the member's
      // own record, and it does not belong in a browser history entry.
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ledger-data-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('The export could not be produced. Please try again.');
    } finally {
      setPending(null);
    }
  }

  async function submitDeletion() {
    setPending('delete');
    setError(null);
    try {
      const response = await fetch('/api/v1/account/deletion', {
        method: 'POST',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error?.message ?? 'The request could not be recorded.');
        return;
      }
      setNotice(body?.data?.message ?? 'Your account is scheduled for deletion.');
      window.location.reload();
    } catch {
      setError('The request could not be recorded. Please try again.');
    } finally {
      setPending(null);
    }
  }

  async function cancelDeletion() {
    setPending('cancel');
    setError(null);
    try {
      const response = await fetch('/api/v1/account/deletion', {
        method: 'DELETE',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? 'The request could not be withdrawn.');
        return;
      }
      window.location.reload();
    } catch {
      setError('The request could not be withdrawn. Please try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="text-sm text-signal-immediate">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-sm text-ink-700">
          {notice}
        </p>
      ) : null}

      <div className="surface p-5">
        <h3 className="text-base font-semibold">Export your data</h3>
        <p className="mt-1 text-sm text-ink-700">
          A machine-readable copy of your profile, preferences, saved records,
          notes, saved searches and support history. No card details are
          included, because none are ever held here.
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={downloadExport}
          disabled={pending !== null}
        >
          {pending === 'export' ? 'Preparing…' : 'Download my data'}
        </Button>
      </div>

      <div className="surface p-5">
        <h3 className="text-base font-semibold">Delete your account</h3>

        {deletionRequestedAt ? (
          <>
            <p className="mt-1 text-sm text-ink-700">
              Your account is closed and scheduled for permanent deletion in{' '}
              <strong>
                {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}
              </strong>
              . Until then nothing has been removed and you can change your
              mind.
            </p>
            <Button
              variant="secondary"
              className="mt-4"
              onClick={cancelDeletion}
              disabled={pending !== null}
            >
              {pending === 'cancel' ? 'Restoring…' : 'Keep my account'}
            </Button>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-700">
              This closes your account immediately and permanently deletes your
              profile, preferences, saved records, notes and saved searches
              after 30 days. Within those 30 days you can sign in and undo it;
              afterwards it cannot be recovered.
            </p>
            <p className="mt-2 text-sm text-ink-700">
              Records we are required to keep for tax and accounting are
              retained, with your name removed.
            </p>

            <label
              htmlFor="delete-confirmation"
              className="mt-4 block text-sm font-medium"
            >
              Type DELETE to confirm
            </label>
            <input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              className="mt-1 w-48 rounded-lg border border-ink-300 px-3 py-2 text-sm"
            />

            <Button
              variant="danger"
              className="mt-4 block"
              onClick={submitDeletion}
              disabled={confirmation !== 'DELETE' || pending !== null}
            >
              {pending === 'delete' ? 'Closing…' : 'Delete my account'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
