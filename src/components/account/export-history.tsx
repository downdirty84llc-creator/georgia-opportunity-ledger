'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/primitives';

interface ExportSummary {
  id: string;
  status: string;
  row_count: number | null;
  requested_at: string;
  expires_at: string;
  truncated: boolean;
}

export function ExportHistory({ jobs }: { jobs: ExportSummary[] }) {
  const router = useRouter();
  const [message, setMessage] = useState('');
  const pending = jobs.some((job) =>
    ['queued', 'processing'].includes(job.status),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), 15_000);
    return () => clearInterval(timer);
  }, [pending, router]);
  async function download(id: string) {
    setMessage('');
    try {
      const response = await fetch(`/api/v1/exports/${id}`, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok || !body.data?.downloadUrl) {
        setMessage(
          body.error?.message ??
            body.data?.message ??
            'The download is unavailable.',
        );
        router.refresh();
        return;
      }
      window.location.assign(body.data.downloadUrl);
    } catch {
      setMessage('The download could not be prepared. Please try again.');
    }
  }
  return (
    <section className="mt-6" aria-label="Recent exports">
      {message ? (
        <p role="status" className="mb-4 text-red-800">
          {message}
        </p>
      ) : null}
      <Button variant="secondary" onClick={() => router.refresh()}>
        Refresh status
      </Button>
      {jobs.length === 0 ? (
        <p className="mt-4">
          No exports yet. Start one from the opportunities list.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {jobs.map((job) => {
            const expired = new Date(job.expires_at).getTime() <= Date.now();
            return (
              <li key={job.id} className="rounded-lg border border-ink-200 p-4">
                <p>
                  Requested{' '}
                  {new Date(job.requested_at).toLocaleString('en-US', {
                    timeZone: 'America/New_York',
                  })}{' '}
                  Eastern
                </p>
                <p className="mt-1 text-sm text-ink-600">
                  {expired
                    ? 'Expired — request a new export.'
                    : job.status === 'failed'
                      ? 'Could not finish. Please request a new export or contact support.'
                      : job.status === 'ready'
                        ? `${job.row_count ?? 0} records ready.`
                        : 'Preparing… This page updates automatically.'}
                </p>
                {job.truncated ? (
                  <p className="text-sm">
                    Reached the 5,000-record limit. Narrow your filters to
                    export the remaining records.
                  </p>
                ) : null}
                {job.status === 'ready' && !expired ? (
                  <Button
                    variant="secondary"
                    onClick={() => download(job.id)}
                    className="mt-2"
                  >
                    Download CSV
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
