/** Production launches with source links until scanned attachments are enabled. */
export function fileAttachmentsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.FILE_ATTACHMENTS_ENABLED === 'false') return false;
  if (env.FILE_ATTACHMENTS_ENABLED === 'true') return true;
  return env.NEXT_PUBLIC_ENVIRONMENT !== 'production';
}

export const ATTACHMENTS_UNAVAILABLE =
  'File attachments are unavailable. Link to the original source document instead.';
