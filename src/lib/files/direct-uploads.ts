import { z } from 'zod';

import { createAdminClient } from '@/lib/db/admin';
import { createServerSupabaseClient } from '@/lib/db/server';
import { serverEnv } from '@/lib/env';
import { safeFileName, UploadRejected } from '@/lib/files/attachments';
import { isAllowedMimeType, sniffMimeType } from '@/lib/files/signatures';

export const UPLOAD_BUCKET = 'attachment-uploads';
export const uploadMetadataSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.string().refine(isAllowedMimeType, 'Unsupported file type.'),
    fileSize: z.number().int().positive().max(26_214_400),
    minimumAccessRank: z.union([
      z.literal(0),
      z.literal(10),
      z.literal(20),
      z.literal(30),
    ]),
    opportunityId: z.string().uuid().nullable().default(null),
    reportId: z.string().uuid().nullable().default(null),
  })
  .strict()
  .refine(
    (value) => Boolean(value.opportunityId) !== Boolean(value.reportId),
    'Choose exactly one opportunity or report.',
  );

type Metadata = z.infer<typeof uploadMetadataSchema>;
interface UploadIntent {
  id: string;
  uploaded_by: string;
  parent_type: 'opportunity' | 'report';
  parent_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  minimum_access_rank: number;
  status: 'waiting' | 'finalizing' | 'completed' | 'rejected';
}
function finalPath(intent: UploadIntent): string {
  const directory =
    intent.parent_type === 'opportunity' ? 'opportunities' : 'reports';
  return `${directory}/${intent.parent_id}/${intent.id}-${intent.file_name}`;
}
function maximumBytes(): number {
  const configured = serverEnv().maxUploadBytes;
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, 26_214_400)
    : 26_214_400;
}
export async function beginAttachmentUpload(input: Metadata, owner: string) {
  if (input.fileSize > maximumBytes())
    throw new UploadRejected('That file exceeds the configured upload limit.');
  const session = await createServerSupabaseClient();
  const parentType = input.opportunityId ? 'opportunity' : 'report';
  const parentId = (input.opportunityId ?? input.reportId)!;
  const { data: parent, error: parentError } = await session
    .from(parentType === 'opportunity' ? 'opportunities' : 'reports')
    .select('id')
    .eq('id', parentId)
    .maybeSingle();
  if (parentError) throw new Error(parentError.message);
  if (!parent) throw new UploadRejected('Record not found.', 404);

  const admin = createAdminClient();
  const id = crypto.randomUUID();
  const { error } = await admin.from('attachment_uploads').insert({
    id,
    uploaded_by: owner,
    parent_type: parentType,
    parent_id: parentId,
    file_name: safeFileName(input.fileName),
    mime_type: input.mimeType,
    file_size: input.fileSize,
    minimum_access_rank: input.minimumAccessRank,
  });
  if (error) throw new Error(error.message);
  // Never upsert. A signed token can only write this isolated staging object,
  // not replace bytes in an already-scanned member attachment.
  const { data, error: signError } = await admin.storage
    .from(UPLOAD_BUCKET)
    .createSignedUploadUrl(id, { upsert: false });
  if (signError || !data)
    throw new Error(signError?.message ?? 'Upload URL unavailable.');
  return { uploadId: id, bucket: UPLOAD_BUCKET, path: id, token: data.token };
}
async function checksum(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    bytes as unknown as ArrayBuffer,
  );
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function finishAttachmentUpload(id: string, owner: string) {
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from('attachment_uploads')
    .select('*')
    .eq('id', id)
    .eq('uploaded_by', owner)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!existing) throw new UploadRejected('Upload not found.', 404);
  if (existing.status === 'completed') {
    const { data: attachment, error } = await admin
      .from('attachments')
      .select('scan_status')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!attachment)
      throw new UploadRejected('That attachment has been deleted.', 404);
    return { id, scanStatus: attachment.scan_status };
  }
  const lease = crypto.randomUUID();
  const { data: claimed, error: claimError } = await admin.rpc(
    'claim_attachment_upload',
    {
      p_id: id,
      p_owner: owner,
      p_lease: lease,
    },
  );
  if (claimError) throw new Error(claimError.message);
  const intent = claimed?.[0] as UploadIntent | undefined;
  if (!intent)
    throw new UploadRejected(
      'Upload expired, rejected or still being finalized. Refresh the file list before retrying.',
      409,
    );

  try {
    const { data: blob, error: downloadError } = await admin.storage
      .from(UPLOAD_BUCKET)
      .download(id);
    if (downloadError || !blob)
      throw new Error(
        downloadError?.message ?? 'Upload has not reached storage.',
      );
    if (blob.size !== Number(intent.file_size) || blob.size > maximumBytes())
      throw new UploadRejected(
        'The uploaded size does not match the accepted file.',
      );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sniff = sniffMimeType(intent.mime_type, bytes);
    if (!sniff.ok)
      throw new UploadRejected(
        sniff.reason ?? 'The file content does not match its type.',
      );
    const hash = await checksum(bytes);
    const target = admin.storage.from(serverEnv().storageBuckets.attachments);
    const path = finalPath(intent);
    const { error: storeError } = await target.upload(path, bytes, {
      contentType: intent.mime_type,
      upsert: false,
    });
    if (storeError) {
      // A lost finalize response may leave the immutable object but no row.
      // Reuse only the identical bytes; never overwrite an existing object.
      const { data: prior, error: priorError } = await target.download(path);
      if (
        priorError ||
        !prior ||
        prior.size !== blob.size ||
        (await checksum(new Uint8Array(await prior.arrayBuffer()))) !== hash
      )
        throw new Error(storeError.message);
    }
    const { error: completeError } = await admin.rpc(
      'complete_attachment_upload',
      {
        p_id: id,
        p_lease: lease,
        p_checksum: hash,
      },
    );
    if (completeError) throw new Error(completeError.message);
    // Scanning is asynchronous. Only a clean worker verdict permits downloads.
    return { id, scanStatus: 'pending' };
  } catch (error) {
    const { error: releaseError } = await admin
      .from('attachment_uploads')
      .update({
        status: error instanceof UploadRejected ? 'rejected' : 'waiting',
        lease_id: null,
        lease_until: null,
      })
      .eq('id', id)
      .eq('lease_id', lease);
    if (releaseError) throw new Error(releaseError.message);
    throw error;
  }
}
/** Tokens expire after two hours. Cleanup waits three so a token cannot
 * recreate a staged object after its cleanup record has been removed. */
export async function cleanupAttachmentUploads(
  deadlineAt: number,
): Promise<number> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: rows, error } = await admin
    .from('attachment_uploads')
    .select('*')
    .lt('cleanup_after', now)
    .or(`lease_until.is.null,lease_until.lt.${now}`)
    .order('cleanup_after')
    .limit(20);
  if (error) throw new Error(error.message);
  let cleaned = 0;
  for (const intent of (rows ?? []) as UploadIntent[]) {
    if (Date.now() >= deadlineAt) break;
    const { error: sourceError } = await admin.storage
      .from(UPLOAD_BUCKET)
      .remove([intent.id]);
    if (sourceError) throw new Error(sourceError.message);
    // A crashed finalize can leave a private final object without its row.
    const { data: attachment, error: readError } = await admin
      .from('attachments')
      .select('id')
      .eq('id', intent.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!attachment) {
      const { error: targetError } = await admin.storage
        .from(serverEnv().storageBuckets.attachments)
        .remove([finalPath(intent)]);
      if (targetError) throw new Error(targetError.message);
    }
    const { error: deleteError } = await admin
      .from('attachment_uploads')
      .delete()
      .eq('id', intent.id);
    if (deleteError) throw new Error(deleteError.message);
    cleaned += 1;
  }
  return cleaned;
}
