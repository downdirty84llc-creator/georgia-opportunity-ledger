import { isProduction } from '@/lib/env';

/**
 * Virus scanning for uploads (spec 20, "where supported").
 *
 * The scanner sits behind this interface for the same reason the email
 * provider does: which engine runs is a deployment decision, and the calling
 * code should not change when it changes.
 *
 * Two providers ship:
 *
 *   - `clamav`, which posts the bytes to a ClamAV REST front end (clamav-rest,
 *     clamd's HTTP wrapper, or any service with the same shape). This is the
 *     one to run in production; a scanner is not something to reimplement.
 *   - `none`, which returns `skipped`. Honest about having done nothing rather
 *     than returning `clean`, which is the failure that makes an unconfigured
 *     scanner worse than no scanner at all.
 *
 * Anything unexpected returns `failed`, never `clean`. A `failed` file is not
 * downloadable and the rescan job retries it, so a scanner outage delays
 * attachments instead of waving them through.
 */

export type ScanVerdict =
  | 'clean'
  | 'infected'
  | 'failed'
  | 'skipped';

export interface ScanOutcome {
  verdict: ScanVerdict;
  /** Signature name for `infected`, error text for `failed`. */
  detail: string | null;
  scanner: string;
}

export interface ScannerConfig {
  provider: 'clamav' | 'none';
  url: string;
  apiKey: string;
  timeoutMs: number;
}

export function scannerConfig(): ScannerConfig {
  const url = process.env.FILE_SCANNER_URL ?? '';
  const declared = process.env.FILE_SCANNER_PROVIDER ?? (url ? 'clamav' : 'none');

  return {
    provider: declared === 'clamav' && url ? 'clamav' : 'none',
    url,
    apiKey: process.env.FILE_SCANNER_API_KEY ?? '',
    timeoutMs: Number(process.env.FILE_SCANNER_TIMEOUT_MS ?? 20_000),
  };
}

/**
 * ClamAV's REST wrappers answer 200 for clean and 406 for a hit, with the
 * signature name in the body. Both shapes are read here so the same setting
 * works against clamav-rest and the newer clamav-rest-api.
 */
async function scanWithClamav(
  bytes: Uint8Array,
  fileName: string,
  config: ScannerConfig,
): Promise<ScanOutcome> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([bytes as unknown as BlobPart], {
      type: 'application/octet-stream',
    }),
    fileName,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
    });

    const body = (await response.text()).slice(0, 500);

    // 406 is clamav-rest's "found something". 200 with "FOUND" in the body is
    // the other convention. Treat either as infected.
    if (response.status === 406 || /\bFOUND\b/i.test(body)) {
      return {
        verdict: 'infected',
        detail: body.trim() || 'Signature match reported by scanner.',
        scanner: 'clamav',
      };
    }

    if (!response.ok) {
      return {
        verdict: 'failed',
        detail: `Scanner returned ${response.status}: ${body}`,
        scanner: 'clamav',
      };
    }

    return { verdict: 'clean', detail: null, scanner: 'clamav' };
  } catch (error) {
    return {
      verdict: 'failed',
      detail:
        error instanceof Error && error.name === 'AbortError'
          ? `Scanner did not answer within ${config.timeoutMs}ms.`
          : error instanceof Error
            ? error.message
            : String(error),
      scanner: 'clamav',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function scanBytes(
  bytes: Uint8Array,
  fileName: string,
  config: ScannerConfig = scannerConfig(),
): Promise<ScanOutcome> {
  if (config.provider === 'none') {
    if (isProduction) {
      // Loud, because the runbook's launch checklist has a line for this and
      // a silent skip in production is exactly what that line is guarding.
      console.warn(
        '[scanner] no FILE_SCANNER_URL configured in production; ' +
          'attachments are being stored unscanned',
      );
    }
    return {
      verdict: 'skipped',
      detail: 'No scanner configured for this environment.',
      scanner: 'none',
    };
  }

  return scanWithClamav(bytes, fileName, config);
}

/** Whether a member (as opposed to staff) may download a file in this state. */
export function isDownloadable(scanStatus: string): boolean {
  return scanStatus === 'clean' || scanStatus === 'skipped';
}
