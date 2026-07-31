/**
 * Content sniffing for uploads.
 *
 * The `Content-Type` on a multipart part is whatever the client typed. Storage
 * will happily serve back what it was told, so a file uploaded as `image/png`
 * and actually containing HTML becomes a stored cross-site-scripting payload
 * on the storage origin. Checking the declared type against the leading bytes
 * closes that, and it is the check the spec 26 file-upload test is looking for.
 *
 * This is not a virus scanner and does not pretend to be one — see
 * `scanner.ts`. It answers a narrower question: is this file the kind of thing
 * it claims to be?
 */

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** ASCII of the first `length` bytes, for the text formats. */
function head(bytes: Uint8Array, length: number): string {
  return String.fromCharCode(...bytes.subarray(0, Math.min(length, bytes.length)));
}

const PDF = [0x25, 0x50, 0x44, 0x46] as const; // %PDF
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG = [0xff, 0xd8, 0xff] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // RIFF....WEBP
const WEBP = [0x57, 0x45, 0x42, 0x50] as const;
const ZIP = [0x50, 0x4b, 0x03, 0x04] as const; // xlsx is a zip container

/**
 * Markup that a browser would execute if the file were ever served inline.
 * Checked on the text formats, where there is no signature to rely on.
 */
const SCRIPTABLE = /<\s*(script|iframe|object|embed|svg|!doctype\s+html|html)\b/i;

export interface SniffResult {
  ok: boolean;
  /** Populated when `ok` is false; safe to show to the uploader. */
  reason?: string;
}

/**
 * Whether the bytes are consistent with the declared type.
 *
 * Deliberately strict on the binary formats — they all have signatures, so
 * there is no reason to accept a file without one. CSV has no signature, so it
 * is checked the other way round: it must not begin with anything a browser
 * would treat as markup, and it must decode as text.
 */
export function sniffMimeType(
  declared: string,
  bytes: Uint8Array,
): SniffResult {
  if (bytes.length === 0) return { ok: false, reason: 'The file is empty.' };

  switch (declared) {
    case 'application/pdf':
      return startsWith(bytes, PDF)
        ? { ok: true }
        : { ok: false, reason: 'That is not a PDF — it has no %PDF header.' };

    case 'image/png':
      return startsWith(bytes, PNG)
        ? { ok: true }
        : { ok: false, reason: 'That is not a PNG.' };

    case 'image/jpeg':
      return startsWith(bytes, JPEG)
        ? { ok: true }
        : { ok: false, reason: 'That is not a JPEG.' };

    case 'image/webp':
      return startsWith(bytes, RIFF) &&
        bytes.length >= 12 &&
        startsWith(bytes.subarray(8), WEBP)
        ? { ok: true }
        : { ok: false, reason: 'That is not a WebP image.' };

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return startsWith(bytes, ZIP)
        ? { ok: true }
        : {
            ok: false,
            reason:
              'That is not an .xlsx workbook. An older .xls file will not do — ' +
              're-save it as .xlsx.',
          };

    case 'text/csv': {
      const sample = head(bytes, 1024);
      if (SCRIPTABLE.test(sample)) {
        return {
          ok: false,
          reason: 'That file contains markup, so it is not a CSV.',
        };
      }
      // A UTF-16 or binary payload renamed to .csv.
      if (bytes.subarray(0, 512).includes(0x00)) {
        return { ok: false, reason: 'That file is not plain text.' };
      }
      return { ok: true };
    }

    default:
      return { ok: false, reason: `Files of type ${declared} are not accepted.` };
  }
}
