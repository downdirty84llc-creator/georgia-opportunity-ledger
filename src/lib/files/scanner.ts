import { isProduction } from '@/lib/env';

/**
 * Virus scanning for uploads (spec 20, "where supported").
 *
 * The scanner sits behind this interface for the same reason the email
 * provider does: which engine runs is a deployment decision, and the calling
 * code should not change when it changes.
 *
 * Providers:
 *
 *   - `clamav`, which posts the bytes to a ClamAV REST front end (clamav-rest,
 *     clamd's HTTP wrapper, or any service with the same shape). This is the
 *     one to run in production; a scanner is not something to reimplement.
 *   - `none`, which returns `failed` in production and `skipped` in development.
 *     Neither state permits a download.
 *   - `bouncer` uses the durable background worker, never this inline adapter.
 *
 * Anything unexpected returns `failed`, never `clean`. A `failed` file is not
 * downloadable and the rescan job retries it, so a scanner outage delays
 * attachments instead of waving them through.
 */

export type ScanVerdict =
  'clean' | 'infected' | 'failed' | 'skipped' | 'pending';

export interface ScanOutcome {
  verdict: ScanVerdict;
  /** Signature name for `infected`, error text for `failed`. */
  detail: string | null;
  scanner: string;
}

export interface ScannerConfig {
  provider: 'clamav' | 'bouncer' | 'none';
  url: string;
  apiKey: string;
  timeoutMs: number;
}

export function scannerConfig(): ScannerConfig {
  const url = process.env.FILE_SCANNER_URL ?? '';
  const declared =
    process.env.FILE_SCANNER_PROVIDER ?? (url ? 'clamav' : 'none');

  return {
    provider:
      declared === 'bouncer'
        ? 'bouncer'
        : declared === 'clamav' && url
          ? 'clamav'
          : 'none',
    url,
    apiKey:
      declared === 'bouncer'
        ? (process.env.BOUNCER_API_KEY ?? '')
        : (process.env.FILE_SCANNER_API_KEY ?? ''),
    timeoutMs: scanTimeout(
      Number(process.env.FILE_SCANNER_TIMEOUT_MS ?? 20_000),
    ),
  };
}

function scanTimeout(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.min(value, 20_000) : 20_000;
}

/** The HTTP adapter must return a single, explicit ClamD result. */
export function parseScanResponse(status: number, body: string): ScanOutcome {
  const result = body.replace(/\0$/, '').trim();
  if (
    (status === 200 || status === 406) &&
    /^[^\r\n\0]+: [^\r\n\0]+ FOUND$/.test(result)
  ) {
    return {
      verdict: 'infected',
      detail: result.slice(0, 500),
      scanner: 'clamav',
    };
  }
  if (status === 200 && /^(?:stream: )?OK$/.test(result)) {
    return { verdict: 'clean', detail: null, scanner: 'clamav' };
  }
  return {
    verdict: 'failed',
    detail: `Scanner returned no recognized verdict (HTTP ${status}).`,
    scanner: 'clamav',
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
  const timeoutMs = scanTimeout(config.timeoutMs);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(config.url, {
      method: 'POST',
      body: form,
      signal: controller.signal,
      redirect: 'error',
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : {},
    });

    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) {
          await reader.cancel();
          throw new Error('Scanner response exceeded the verdict size limit.');
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks).toString('utf8');
    return parseScanResponse(response.status, body);
  } catch (error) {
    return {
      verdict: 'failed',
      detail:
        error instanceof Error && error.name === 'AbortError'
          ? `Scanner did not answer within ${timeoutMs}ms.`
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
  if (config.provider === 'bouncer') {
    return {
      verdict: 'failed',
      detail: 'Bouncer scans require the durable attachment worker.',
      scanner: 'bouncer',
    };
  }
  if (config.provider === 'none') {
    if (isProduction) {
      // Loud, because the runbook's launch checklist has a line for this and
      // a silent skip in production is exactly what that line is guarding.
      console.warn(
        '[scanner] no FILE_SCANNER_URL configured in production; ' +
          'attachments are withheld until scanning succeeds',
      );
    }
    return {
      verdict: isProduction ? 'failed' : 'skipped',
      detail: 'No scanner configured for this environment.',
      scanner: 'none',
    };
  }

  if (isProduction && !config.url.startsWith('https://')) {
    return {
      verdict: 'failed',
      detail: 'The production scanner requires HTTPS.',
      scanner: 'clamav',
    };
  }

  return scanWithClamav(bytes, fileName, config);
}

/** Whether a member (as opposed to staff) may download a file in this state. */
export function isDownloadable(scanStatus: string): boolean {
  return scanStatus === 'clean';
}
