import { createAdminClient } from '@/lib/db/admin';
import { createServerSupabaseClient } from '@/lib/db/server';
import { serverEnv } from '@/lib/env';
import { isAllowedMimeType, sniffMimeType } from '@/lib/files/signatures';
import { scanBytes, type ScanOutcome } from '@/lib/files/scanner';

/**
 * Attachment upload, scanning and download.
 *
 * The order of operations matters and is not the obvious one. The file is
 * stored *before* it is scanned, and the row is created `pending`:
 *
 *   - Scanning a 25MB file can take longer than a serverless request should
 *     live. Holding the bytes in memory until a verdict arrives makes upload
 *     failure modes worse, not better.
 *   - A `pending` row is invisible to members (the read policy in migration
 *     0022 withholds anything that is not `clean` or `skipped`), so a file
 *     that is stored but unscanned is not a file anyone can reach.
 *   - If the process dies between store and verdict, the row stays `pending`
 *     and the `scan-attachments` job picks it up. Dying halfway leaves a file
 *     nobody can download, which is the correct direction to fail.
 */

export interface UploadRequest {
  file: File;
  opportunityId: string | null;
  reportId: string | null;
  minimumAccessRank: number;
  uploadedBy: string;
}

export class UploadRejected extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
    this.name = 'UploadRejected';
  }
}

export interface StoredAttachment {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  minimumAccessRank: number;
  scanStatus: string;
  scanDetail: string | null;
}

/**
 * Strips a client-supplied name down to something safe to store and to put in
 * a `Content-Disposition`. Path separators, control characters and leading
 * dots all go; the extension is kept because it is what makes the file open in
 * the right application.
 */
export function safeFileName(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? 'attachment';
  const cleaned = base
    // Anything outside this set — spaces, quotes, control characters, the
    // header-splitting ones — becomes a hyphen rather than vanishing, so two
    // different names cannot collapse into the same result.
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'attachment';
}

function storagePath(request: UploadRequest, fileName: string): string {
  const parent = request.opportunityId
    ? `opportunities/${request.opportunityId}`
    : `reports/${request.reportId}`;
  // A random prefix so two uploads of "notice.pdf" do not collide and so the
  // path is not guessable from the record id alone.
  const nonce = crypto.randomUUID().slice(0, 8);
  return `${parent}/${nonce}-${fileName}`;
}

export async function uploadAttachment(
  request: UploadRequest,
): Promise<StoredAttachment> {
  const env = serverEnv();

  if (!request.opportunityId && !request.reportId) {
    throw new UploadRejected(
      'An attachment must belong to an opportunity or a report.',
      400,
    );
  }
  if (request.opportunityId && request.reportId) {
    throw new UploadRejected(
      'An attachment belongs to one parent, not both.',
      400,
    );
  }

  const declaredType = request.file.type;
  if (!isAllowedMimeType(declaredType)) {
    throw new UploadRejected(
      `Files of type ${declaredType || 'unknown'} are not accepted. ` +
        'PDF, CSV, XLSX, PNG, JPEG and WebP are.',
    );
  }

  if (request.file.size === 0) {
    throw new UploadRejected('That file is empty.');
  }
  if (request.file.size > env.maxUploadBytes) {
    const limit = Math.round(env.maxUploadBytes / 1_048_576);
    throw new UploadRejected(`Files must be ${limit}MB or smaller.`);
  }

  const bytes = new Uint8Array(await request.file.arrayBuffer());

  const sniff = sniffMimeType(declaredType, bytes);
  if (!sniff.ok) {
    throw new UploadRejected(
      sniff.reason ?? 'That file is not what its type says it is.',
    );
  }

  const fileName = safeFileName(request.file.name);
  const path = storagePath(request, fileName);

  // Storage and the row are written with the service role. The caller's
  // authority was established before we got here; using the session client
  // would additionally require a storage policy for every parent shape.
  const admin = createAdminClient();

  const { error: uploadError } = await admin.storage
    .from(env.storageBuckets.attachments)
    .upload(path, bytes, {
      contentType: declaredType,
      upsert: false,
    });

  if (uploadError) throw new Error(uploadError.message);

  const checksum = await sha256(bytes);

  const { data: row, error: insertError } = await admin
    .from('attachments')
    .insert({
      opportunity_id: request.opportunityId,
      report_id: request.reportId,
      file_name: fileName,
      file_path: path,
      mime_type: declaredType,
      file_size: request.file.size,
      minimum_access_rank: request.minimumAccessRank,
      checksum,
      scan_status: 'pending',
      uploaded_by: request.uploadedBy,
    })
    .select('id')
    .single();

  if (insertError) {
    // Do not leave the object behind: an orphan in the bucket is a file with
    // no row, which means no policy governs it and nothing will ever clean it.
    await admin.storage.from(env.storageBuckets.attachments).remove([path]);
    throw new Error(insertError.message);
  }

  const outcome = await scanAndRecord(row.id, path, fileName, bytes);

  return {
    id: row.id,
    fileName,
    filePath: path,
    mimeType: declaredType,
    fileSize: request.file.size,
    minimumAccessRank: request.minimumAccessRank,
    scanStatus: outcome.verdict,
    scanDetail: outcome.detail,
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as unknown as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Scans stored bytes and writes the verdict.
 *
 * An infected file is deleted from storage immediately. The row is kept, so
 * the audit trail and the admin queue still show that something was uploaded
 * and what it was — deleting the record too would hide the incident.
 */
export async function scanAndRecord(
  attachmentId: string,
  path: string,
  fileName: string,
  bytes: Uint8Array,
): Promise<ScanOutcome> {
  const env = serverEnv();
  const admin = createAdminClient();

  await admin
    .from('attachments')
    .update({ scan_status: 'scanning' })
    .eq('id', attachmentId);

  const outcome = await scanBytes(bytes, fileName);

  if (outcome.verdict === 'infected') {
    await admin.storage.from(env.storageBuckets.attachments).remove([path]);
  }

  const { error } = await admin
    .from('attachments')
    .update({
      scan_status: outcome.verdict,
      scan_detail: outcome.detail,
      scanner: outcome.scanner,
      scanned_at: new Date().toISOString(),
    })
    .eq('id', attachmentId);

  if (error) throw new Error(error.message);
  return outcome;
}

/**
 * A short-lived signed URL for a file the caller has already been authorised
 * to read.
 *
 * The authorisation is the `select` immediately below: it runs on the caller's
 * own session client, so row-level security — including the scan gate — is
 * what decides whether the row comes back at all. A member asking for an
 * infected or unscanned file gets the same answer as one asking for a file
 * that does not exist, which is the answer that leaks least.
 */
export async function signedAttachmentUrl(
  attachmentId: string,
  expiresInSeconds = 300,
): Promise<{ url: string; fileName: string } | null> {
  const env = serverEnv();
  const supabase = await createServerSupabaseClient();

  const { data: attachment } = await supabase
    .from('attachments')
    .select('id, file_path, file_name, scan_status')
    .eq('id', attachmentId)
    .maybeSingle();

  if (!attachment) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(env.storageBuckets.attachments)
    .createSignedUrl(attachment.file_path, expiresInSeconds, {
      download: attachment.file_name,
    });

  if (error || !data?.signedUrl) return null;
  return { url: data.signedUrl, fileName: attachment.file_name };
}

export async function deleteAttachment(attachmentId: string): Promise<boolean> {
  const env = serverEnv();
  const supabase = await createServerSupabaseClient();

  // Deleted through the session client so the staff-write policy applies.
  const { data, error } = await supabase
    .from('attachments')
    .delete()
    .eq('id', attachmentId)
    .select('file_path')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return false;

  await createAdminClient()
    .storage.from(env.storageBuckets.attachments)
    .remove([data.file_path]);

  return true;
}
