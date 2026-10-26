import {
  scanBytes,
  scannerConfig,
  type ScannerConfig,
} from '../src/lib/files/scanner';
import { createHash } from 'node:crypto';
import {
  createBouncerScan,
  pollBouncerScan,
  uploadBouncerFile,
} from '../src/lib/files/bouncer';

interface ScannerCheck {
  status: 'pass' | 'fail' | 'unknown';
  detail: string;
}

/** Never include the URL: it may contain scanner credentials. */
export function scannerConfigurationCheck(
  provider: string | undefined,
  url: string,
  production: boolean,
  bouncerKey = process.env.BOUNCER_API_KEY ?? '',
): ScannerCheck {
  if (provider === 'bouncer') {
    return /^bnc_live_[A-Za-z0-9_-]+$/.test(bouncerKey)
      ? {
          status: 'pass',
          detail:
            'Bouncer credential configured. Probes spend two scan credits; durable migration and deployed workflow still require verification.',
        }
      : {
          status: 'fail',
          detail: 'BOUNCER_API_KEY is missing or invalid; no probe was sent.',
        };
  }
  if (!url || !url.trim()) {
    return {
      status: 'fail',
      detail: 'FILE_SCANNER_URL is unset or blank; downloads stay blocked.',
    };
  }
  // An absent setting selects clamav in the application; an empty or unknown
  // explicit provider does not. Keep the same nullish default here.
  if ((provider ?? 'clamav') !== 'clamav') {
    return {
      status: 'fail',
      detail:
        'FILE_SCANNER_PROVIDER must be clamav; the configured provider does not scan files.',
    };
  }
  try {
    const parsed = new URL(url);
    if (
      url !== url.trim() ||
      !/^https?:$/.test(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new Error('Invalid scanner endpoint');
    }
    // Match the production adapter's literal HTTPS requirement as well.
    if (production && !url.startsWith('https://')) {
      return {
        status: 'fail',
        detail: 'The production scanner requires HTTPS; no probe was sent.',
      };
    }
  } catch {
    return {
      status: 'fail',
      detail:
        'FILE_SCANNER_URL must be an absolute HTTP(S) endpoint without user information or a fragment.',
    };
  }
  return {
    status: 'pass',
    detail:
      'ClamAV endpoint configured; clean-file acceptance and EICAR detection require separate probes.',
  };
}

/** Assembled so the source file is not itself an antivirus test sample. */
const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$' + 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const CLEAN = 'Georgia Opportunity Ledger scanner readiness control.\n';

/** Exercise the same multipart client, limits and verdict parser as uploads. */
export async function scannerReadinessChecks(
  configuration: ScannerCheck,
  config: ScannerConfig = scannerConfig(),
): Promise<{ clean: ScannerCheck; eicar: ScannerCheck }> {
  if (
    configuration.status !== 'pass' ||
    !['clamav', 'bouncer'].includes(config.provider)
  ) {
    const skipped: ScannerCheck = {
      status: 'unknown',
      detail: 'Scanner configuration is not usable; no probe was sent.',
    };
    return { clean: { ...skipped }, eicar: { ...skipped } };
  }

  const probe = async (
    body: string,
    name: string,
    expected: 'clean' | 'infected',
  ): Promise<ScannerCheck> => {
    let outcome;
    if (config.provider === 'bouncer') {
      try {
        const bytes = new TextEncoder().encode(body);
        const file = {
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
        const signal = AbortSignal.timeout(20_000);
        const ticket = await createBouncerScan(config.apiKey, file, signal);
        await uploadBouncerFile(ticket, bytes, signal);
        do {
          outcome = await pollBouncerScan(
            config.apiKey,
            ticket.id,
            file,
            signal,
          );
          if (outcome.verdict === 'pending')
            await new Promise<void>((resolve) => setTimeout(resolve, 2000));
        } while (outcome.verdict === 'pending' && !signal.aborted);
      } catch {
        outcome = { verdict: 'failed' };
      }
    } else {
      outcome = await scanBytes(new TextEncoder().encode(body), name, config);
    }
    if (
      outcome.verdict === 'failed' ||
      outcome.verdict === 'skipped' ||
      outcome.verdict === 'pending'
    ) {
      return {
        status: 'unknown',
        detail:
          'The application scanner client did not obtain a usable verdict; delivery or scanner health remains unverified.',
      };
    }
    return {
      status: outcome.verdict === expected ? 'pass' : 'fail',
      detail:
        outcome.verdict === expected
          ? expected === 'clean'
            ? 'Harmless control accepted as clean.'
            : 'EICAR control detected as infected.'
          : expected === 'clean'
            ? 'Harmless control was rejected as infected.'
            : 'EICAR control was incorrectly accepted as clean.',
    };
  };
  const clean = await probe(CLEAN, 'ledger-clean-control.txt', 'clean');
  const eicar = await probe(EICAR, 'ledger-eicar-control.com', 'infected');
  return { clean, eicar };
}
