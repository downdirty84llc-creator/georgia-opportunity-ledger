'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

/**
 * Creates a draft report and drops the editor straight into the composer.
 *
 * A separate "create" form would be a page of typing before any work happens;
 * the only thing genuinely needed up front is a title, and even that is
 * editable one screen later.
 */
export function NewReportButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [reportType, setReportType] = useState('weekly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    // Default the period to the week just gone — the common case for a weekly.
    const end = new Date();
    const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);

    try {
      const response = await fetch('/api/v1/admin/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          reportType,
          periodStart: start.toISOString().slice(0, 10),
          periodEnd: end.toISOString().slice(0, 10),
          minimumAccessRank: reportType === 'premium_briefing' ? 30 : 10,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error?.message ?? 'The report could not be created.');
        return;
      }

      router.push(`/admin/reports/${payload.data.id}`);
    } catch {
      setError('The report could not be created. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>New report</Button>;
  }

  return (
    <form onSubmit={create} className="surface w-full max-w-md p-4">
      <label htmlFor="new-report-title" className="block text-sm font-medium">
        Report title
      </label>
      <input
        id="new-report-title"
        required
        minLength={4}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="The Weekly Ledger — 30 July"
        className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
      />

      <label
        htmlFor="new-report-type"
        className="mt-3 block text-sm font-medium"
      >
        Type
      </label>
      <select
        id="new-report-type"
        value={reportType}
        onChange={(event) => setReportType(event.target.value)}
        className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
      >
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
        <option value="pricing">Pricing</option>
        <option value="premium_briefing">Premium briefing</option>
        <option value="special">Special</option>
      </select>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create and compose'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
