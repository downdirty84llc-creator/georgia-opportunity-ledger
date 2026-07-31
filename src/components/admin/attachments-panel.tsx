'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button, Card, Pill } from '@/components/ui/primitives';
import { ACCESS_RANK } from '@/lib/access/ranks';

interface AttachmentRow {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  minimum_access_rank: number;
  scan_status: string;
  scan_detail: string | null;
  scanner: string | null;
  scanned_at: string | null;
  uploaded_at: string;
}

const RANK_OPTIONS = [
  { value: ACCESS_RANK.free, label: 'Everyone (Free)' },
  { value: ACCESS_RANK.weekly, label: 'Weekly and above' },
  { value: ACCESS_RANK.detailed, label: 'Detailed and above' },
  { value: ACCESS_RANK.premium, label: 'Premium only' },
];

/**
 * How each scan state reads to the person who uploaded the file. Members never
 * see these words — they simply do not see the file — so the copy is written
 * for the editor deciding whether to wait, retry or investigate.
 */
const SCAN_LABELS: Record<string, { text: string; tone: 'positive' | 'warning' | 'neutral' }> = {
  clean: { text: 'Scanned — clean', tone: 'positive' },
  skipped: { text: 'Not scanned (no scanner configured)', tone: 'warning' },
  pending: { text: 'Waiting to be scanned', tone: 'warning' },
  scanning: { text: 'Scanning', tone: 'neutral' },
  failed: { text: 'Scan failed — hidden from members', tone: 'warning' },
  infected: { text: 'Rejected by scanner — file deleted', tone: 'warning' },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

export function AttachmentsPanel({
  opportunityId,
  reportId,
}: {
  opportunityId?: string;
  reportId?: string;
}) {
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rank, setRank] = useState<number>(ACCESS_RANK.free);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = opportunityId
    ? `opportunityId=${opportunityId}`
    : `reportId=${reportId}`;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/v1/admin/attachments?${query}`, {
        cache: 'no-store',
      });
      const body: { data?: AttachmentRow[] } = await response.json();
      if (response.ok) setRows(body.data ?? []);
    } catch {
      setError('Could not load the file list.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setNotice(null);

    const form = new FormData();
    form.append('file', file);
    form.append('minimumAccessRank', String(rank));
    if (opportunityId) form.append('opportunityId', opportunityId);
    if (reportId) form.append('reportId', reportId);

    try {
      const response = await fetch('/api/v1/admin/attachments', {
        method: 'POST',
        body: form,
      });
      const body: {
        data?: { message?: string };
        error?: { message?: string };
      } = await response.json();

      if (!response.ok) {
        setError(body.error?.message ?? 'The upload was refused.');
        return;
      }
      setNotice(body.data?.message ?? 'Uploaded.');
      if (inputRef.current) inputRef.current.value = '';
      await load();
    } catch {
      setError('Could not reach the server. Nothing was uploaded.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: AttachmentRow) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/admin/attachments/${row.id}`, {
        method: 'DELETE',
      });
      if (!response.ok && response.status !== 204) {
        setError('Could not delete that file.');
        return;
      }
      setNotice(`Deleted ${row.file_name}.`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h2 className="text-base font-semibold">Attachments</h2>
      <p className="mt-1 text-sm text-ink-600">
        PDF, CSV, XLSX, PNG, JPEG or WebP, up to 25MB. Every file is virus
        scanned before members can reach it; one that has not been cleared stays
        invisible to them and is retried automatically.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="attachment-rank" className="block text-sm font-medium">
            Who may download it
          </label>
          <select
            id="attachment-rank"
            value={rank}
            onChange={(event) => setRank(Number(event.target.value))}
            className="mt-1 rounded-md border border-ink-300 px-3 py-2 text-sm"
          >
            {RANK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="attachment-file" className="block text-sm font-medium">
            File
          </label>
          <input
            id="attachment-file"
            ref={inputRef}
            type="file"
            disabled={busy}
            accept=".pdf,.csv,.xlsx,.png,.jpg,.jpeg,.webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
            className="mt-1 block text-sm"
          />
        </div>
      </div>

      {busy ? (
        <p role="status" className="mt-3 text-sm text-ink-600">
          Uploading and scanning…
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="mt-3 rounded-md border border-green-700 bg-green-50 px-3 py-2 text-sm text-green-900"
        >
          {notice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-700 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {error}
        </p>
      ) : null}

      <ul className="mt-5 divide-y divide-ink-200 border-t border-ink-200">
        {loading ? (
          <li className="py-3 text-sm text-ink-600">Loading…</li>
        ) : rows.length === 0 ? (
          <li className="py-3 text-sm text-ink-600">No files yet.</li>
        ) : (
          rows.map((row) => {
            const scan = SCAN_LABELS[row.scan_status] ?? {
              text: row.scan_status,
              tone: 'neutral' as const,
            };
            const rankLabel =
              RANK_OPTIONS.find((o) => o.value === row.minimum_access_rank)
                ?.label ?? `Rank ${row.minimum_access_rank}`;

            return (
              <li
                key={row.id}
                className="flex flex-wrap items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.file_name}</p>
                  <p className="text-sm text-ink-600">
                    {formatSize(row.file_size)} · {rankLabel}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Pill tone={scan.tone}>{scan.text}</Pill>
                    {row.scan_detail ? (
                      <span className="text-xs text-ink-600">
                        {row.scan_detail}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {row.scan_status === 'clean' || row.scan_status === 'skipped' ? (
                    <a
                      href={`/api/v1/attachments/${row.id}`}
                      className="rounded-md px-2.5 py-1.5 text-sm font-medium text-ink-700 underline hover:bg-ink-100"
                    >
                      Download
                    </a>
                  ) : null}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void remove(row)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </Card>
  );
}
