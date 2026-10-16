import { withAdminHandling } from '@/lib/http/admin-handler';
import { z } from 'zod';
import { finishAttachmentUpload } from '@/lib/files/direct-uploads';
import { uploadAuthority, uploadFailure } from '@/lib/files/upload-route';
import { apiError, ok } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const POST = withAdminHandling(async (request) => {
  const owner = await uploadAuthority(request);
  if (typeof owner !== 'string') return owner;
  const raw = await request.json().catch(() => null);
  if (!raw) return apiError('bad_request', 'Send the upload ID as JSON.');
  const input = z.object({ uploadId: z.string().uuid() }).strict().parse(raw);
  try {
    return ok({
      ...(await finishAttachmentUpload(input.uploadId, owner)),
      message:
        'Uploaded. Members can download the file only after a clean scan.',
    });
  } catch (error) {
    return uploadFailure(error);
  }
});
