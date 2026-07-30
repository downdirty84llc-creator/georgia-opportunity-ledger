'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

/**
 * Opens the Stripe customer portal.
 *
 * Payment methods, invoices and card details live entirely in Stripe, which is
 * what keeps this application's PCI surface at zero.
 */
export function BillingPortalButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/billing/create-portal-session', {
        method: 'POST',
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.data?.url) {
        setError(
          payload?.error?.message ?? 'The billing portal could not be opened.',
        );
        return;
      }
      window.location.href = payload.data.url;
    } catch {
      setError('The billing portal could not be opened. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-right">
      <Button variant="secondary" onClick={open} disabled={busy}>
        {busy ? 'Opening…' : 'Manage billing'}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </div>
  );
}
