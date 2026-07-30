'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

/**
 * Saves a record to the member's list.
 *
 * When the plan limit is reached the API answers 402 with the message and the
 * plan that would help; that message is shown verbatim rather than replaced
 * with a generic failure, because the server already knows the useful thing to
 * say.
 */
export function SaveOpportunityButton({
  opportunityId,
  initiallySaved = false,
}: {
  opportunityId: string;
  initiallySaved?: boolean;
}) {
  const [saved, setSaved] = useState(initiallySaved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);

  async function save() {
    setBusy(true);
    setMessage(null);
    setNeedsUpgrade(false);
    try {
      const response = await fetch('/api/v1/saved-opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opportunityId }),
      });
      const payload = await response.json().catch(() => null);

      if (response.status === 409) {
        setSaved(true);
        setMessage('Already in your saved list.');
        return;
      }
      if (!response.ok) {
        setMessage(payload?.error?.message ?? 'Could not save that record.');
        setNeedsUpgrade(response.status === 402);
        return;
      }
      setSaved(true);
      setMessage('Saved to your list.');
    } catch {
      setMessage('Could not save that record. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={save} disabled={busy || saved}>
        {saved ? 'Saved' : busy ? 'Saving…' : 'Save opportunity'}
      </Button>
      {message ? (
        <p role="status" className="text-sm text-ink-600">
          {message}{' '}
          {needsUpgrade ? (
            <a href="/pricing" className="font-medium text-ink-900 underline">
              Compare plans
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
