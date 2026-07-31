'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/primitives';
import { formatDate } from '@/lib/format';

/**
 * Cancels at period end.
 *
 * Confirmation states plainly what cancelling does and does not do. A member
 * who thinks cancelling deletes their saved work will not cancel — and will
 * resent us for it later — so the copy leads with what they keep.
 */
export function CancelSubscriptionButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  async function cancel() {
    setBusy(true);
    setIsError(false);
    try {
      const response = await fetch('/api/v1/billing/cancel', {
        method: 'POST',
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setIsError(true);
        setResult(
          payload?.error?.message ??
            'Your subscription could not be cancelled. Contact support.',
        );
        return;
      }

      const until = payload?.data?.accessUntil;
      setResult(
        until
          ? `Cancelled. Your access continues until ${formatDate(until)}.`
          : (payload?.data?.message ?? 'Cancelled.'),
      );
      setConfirming(false);
      router.refresh();
    } catch {
      setIsError(true);
      setResult('Your subscription could not be cancelled. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <p
        role="status"
        className={
          isError ? 'text-sm text-red-800' : 'text-sm text-emerald-800'
        }
      >
        {result}
      </p>
    );
  }

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        Cancel subscription
      </Button>
    );
  }

  return (
    <div className="w-full rounded-lg border border-ink-300 bg-ink-50 p-4">
      <p className="text-sm font-semibold">Cancel your subscription?</p>
      <ul className="mt-2 space-y-1 text-sm text-ink-700">
        <li>
          Your access continues to the end of the period you have paid for.
        </li>
        <li>Your saved opportunities, notes and searches are all kept.</li>
        <li>Your account stays open at the free tier.</li>
        <li>You can resubscribe at any time.</li>
      </ul>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="danger" onClick={cancel} disabled={busy}>
          {busy ? 'Cancelling…' : 'Yes, cancel at period end'}
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(false)}>
          Keep my subscription
        </Button>
      </div>
    </div>
  );
}
