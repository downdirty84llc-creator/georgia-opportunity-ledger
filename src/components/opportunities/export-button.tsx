'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/primitives';

/**
 * Requests a CSV export.
 *
 * Small exports come back with a download URL immediately; large ones return a
 * job id and are prepared in the background. Both cases are handled here so the
 * member never has to know which path they took.
 */
export function ExportButton({
  allowed,
  deniedMessage,
  opportunityIds,
}: {
  allowed: boolean;
  deniedMessage: string;
  opportunityIds: readonly string[];
}) {
  const [status, setStatus] = useState<'idle' | 'working' | 'ready' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  if (!allowed) {
    return (
      <a
        href="/pricing"
        className="inline-flex items-center rounded-lg border border-ink-200 px-3 py-2 text-sm text-ink-500 hover:border-ink-300 hover:text-ink-700"
      >
        {deniedMessage || 'CSV export is a Premium feature'}
      </a>
    );
  }

  async function requestExport() {
    setStatus('working');
    setMessage('');
    setDownloadUrl(null);
    try {
      const response = await fetch('/api/v1/exports/opportunities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opportunityIds: [...opportunityIds],
          format: 'csv',
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setStatus('error');
        setMessage(payload?.error?.message ?? 'The export could not be started.');
        return;
      }

      if (payload?.data?.downloadUrl) {
        setStatus('ready');
        setDownloadUrl(payload.data.downloadUrl);
        setMessage(payload.data.message ?? 'Your export is ready.');
        return;
      }

      setStatus('ready');
      setMessage(
        payload?.data?.message ??
          'Your export is being prepared. We will email you when it is ready.',
      );
    } catch {
      setStatus('error');
      setMessage('The export could not be started. Please try again.');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        onClick={requestExport}
        disabled={status === 'working' || opportunityIds.length === 0}
      >
        {status === 'working' ? 'Preparing…' : 'Export CSV'}
      </Button>
      {message ? (
        <p
          role="status"
          className={
            status === 'error' ? 'text-sm text-red-800' : 'text-sm text-ink-600'
          }
        >
          {message}{' '}
          {downloadUrl ? (
            <a href={downloadUrl} className="font-medium text-ink-900 underline">
              Download
            </a>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
