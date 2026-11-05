import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileAttachmentsEnabled } from '@/lib/files/availability';
import {
  beginAttachmentUpload,
  finishAttachmentUpload,
} from '@/lib/files/direct-uploads';
import { signedAttachmentUrl, uploadAttachment } from '@/lib/files/attachments';

afterEach(() => vi.unstubAllEnvs());
describe('source-link-only launch', () => {
  it('disables production attachments unless explicitly enabled', () => {
    expect(
      fileAttachmentsEnabled({ NEXT_PUBLIC_ENVIRONMENT: 'production' }),
    ).toBe(false);
    expect(
      fileAttachmentsEnabled({
        NEXT_PUBLIC_ENVIRONMENT: 'production',
        FILE_ATTACHMENTS_ENABLED: 'false',
      }),
    ).toBe(false);
    expect(
      fileAttachmentsEnabled({
        NEXT_PUBLIC_ENVIRONMENT: 'production',
        FILE_ATTACHMENTS_ENABLED: 'true',
      }),
    ).toBe(true);
  });
  it('keeps isolated staging tests available but honors explicit disabling', () => {
    expect(fileAttachmentsEnabled({ NEXT_PUBLIC_ENVIRONMENT: 'staging' })).toBe(
      true,
    );
    expect(
      fileAttachmentsEnabled({
        NEXT_PUBLIC_ENVIRONMENT: 'staging',
        FILE_ATTACHMENTS_ENABLED: 'false',
      }),
    ).toBe(false);
  });
  it('rejects both upload paths and completion before touching storage or credentials', async () => {
    vi.stubEnv('FILE_ATTACHMENTS_ENABLED', 'false');
    await expect(beginAttachmentUpload({} as never, 'owner')).rejects.toThrow(
      'File attachments are unavailable',
    );
    await expect(finishAttachmentUpload('upload', 'owner')).rejects.toThrow(
      'File attachments are unavailable',
    );
    await expect(uploadAttachment({} as never)).rejects.toThrow(
      'File attachments are unavailable',
    );
    expect(await signedAttachmentUrl('attachment')).toBeNull();
  });
});
