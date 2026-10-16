import { withAdminHandling } from '@/lib/http/admin-handler';
import {
  beginAttachmentUpload,
  uploadMetadataSchema,
} from '@/lib/files/direct-uploads';
import { uploadAuthority, uploadFailure } from '@/lib/files/upload-route';
import { apiError, created } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';
export const POST = withAdminHandling(async (request) => {
  const owner = await uploadAuthority(request);
  if (typeof owner !== 'string') return owner;
  const raw = await request.json().catch(() => null);
  if (!raw) return apiError('bad_request', 'Send upload details as JSON.');
  const input = uploadMetadataSchema.parse(raw);
  try {
    return created(await beginAttachmentUpload(input, owner), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return uploadFailure(error);
  }
});
