import {
  scanBytes,
  scannerConfig,
  type ScannerConfig,
} from '../src/lib/files/scanner';

interface ScannerCheck {
  status: 'pass' | 'fail' | 'unknown';
  detail: string;
}

/** Never include the URL: it may contain scanner credentials. */
export function scannerConfigurationCheck(
  provider: string | undefined,
  url: string,
  production: boolean,
): ScannerCheck {
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
  if (configuration.status !== 'pass' || config.provider !== 'clamav') {
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
    const outcome = await scanBytes(
      new TextEncoder().encode(body),
      name,
      config,
    );
    if (outcome.verdict === 'failed' || outcome.verdict === 'skipped') {
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
