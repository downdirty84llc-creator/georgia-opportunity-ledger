'use client';

import { createBrowserSupabaseClient } from '@/lib/db/browser';

/** Only metadata crosses the web host. File bytes go directly to private Storage. */
export async function uploadAttachmentFromBrowser(
  file: File,
  options: {
    minimumAccessRank: number;
    opportunityId?: string;
    reportId?: string;
  },
): Promise<string> {
  const reservation = await fetch('/api/v1/admin/attachments/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      minimumAccessRank: options.minimumAccessRank,
      opportunityId: options.opportunityId ?? null,
      reportId: options.reportId ?? null,
    }),
  });
  const ticket = await reservation.json();
  if (!reservation.ok)
    throw new Error(ticket.error?.message ?? 'The upload was refused.');
  const { uploadId, bucket, path, token } = ticket.data;
  const { error: storageError } = await createBrowserSupabaseClient()
    .storage.from(bucket)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (storageError)
    throw new Error(
      'The file transfer did not finish. Refresh the file list and try again.',
    );
  const response = await fetch('/api/v1/admin/attachments/uploads/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      body.error?.message ??
        'The upload could not be confirmed. Refresh the file list before retrying.',
    );
  return body.data?.message ?? 'Uploaded.';
}
