'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/primitives';
import type { OpportunityFilters } from '@/lib/search/filters';

/**
 * Saves the current filter set as a named search.
 *
 * When the viewer's plan does not include saved searches, the button stays
 * visible and explains what it would do rather than disappearing. A feature
 * that silently vanishes teaches members nothing about what they are missing.
 */
export function SaveSearchButton({
  filters,
  allowed,
  deniedMessage,
  label = 'Save this search',
}: {
  filters: OpportunityFilters;
  allowed: boolean;
  deniedMessage: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');

  if (!allowed) {
    return (
      <a
        href="/pricing"
        className="inline-flex items-center rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-500 hover:border-ink-300 hover:text-ink-700"
        title={deniedMessage}
      >
        {deniedMessage || 'Saved searches are a Premium feature'}
      </a>
    );
  }

  async function save() {
    setStatus('saving');
    setMessage('');
    try {
      const { cursor: _cursor, limit: _limit, ...storable } = filters;
      const response = await fetch('/api/v1/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Untitled search',
          filters: JSON.parse(JSON.stringify(storable)),
          alertEnabled: true,
          alertFrequency: 'immediate',
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setStatus('error');
        setMessage(payload?.error?.message ?? 'Could not save that search.');
        return;
      }
      setStatus('saved');
      setMessage('Saved. You will be alerted when a new record matches.');
    } catch {
      setStatus('error');
      setMessage('Could not save that search. Please try again.');
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <div className="surface w-full max-w-sm p-4">
      <label htmlFor="saved-search-name" className="text-sm font-medium">
        Name this search
      </label>
      <input
        id="saved-search-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Warehouses under $500k, Chatham"
        className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm"
      />
      {message ? (
        <p
          role="status"
          className={
            status === 'error'
              ? 'mt-2 text-sm text-red-800'
              : 'mt-2 text-sm text-emerald-800'
          }
        >
          {message}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button onClick={save} disabled={status === 'saving'}>
          {status === 'saving' ? 'Saving…' : 'Save search'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
