import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ isProduction: true }));
import {
  scanBytes,
  scannerConfig,
  usesDurableScanner,
} from '@/lib/files/scanner';

afterEach(() => vi.unstubAllEnvs());

describe('production scanner configuration', () => {
  it('withholds files when no scanner is configured', async () => {
    const result = await scanBytes(new Uint8Array([1]), 'file.pdf', {
      provider: 'none',
      url: '',
      apiKey: '',
      timeoutMs: 1,
    });
    expect(result.verdict).toBe('failed');
  });

  it('refuses to transmit private files over plaintext HTTP', async () => {
    const result = await scanBytes(new Uint8Array([1]), 'file.pdf', {
      provider: 'clamav',
      url: 'http://scanner.invalid',
      apiKey: '',
      timeoutMs: 1,
    });
    expect(result.verdict).toBe('failed');
    expect(result.detail).toContain('HTTPS');
  });

  it.each(['NaN', '-1', '0', '999999'])(
    'bounds malformed or excessive timeouts: %s',
    (value) => {
      vi.stubEnv('FILE_SCANNER_TIMEOUT_MS', value);
      expect(scannerConfig().timeoutMs).toBe(20_000);
    },
  );
});

/**
 * `bouncer` must require its key for the same reason `clamav` requires its URL.
 * Without it the provider used to activate anyway, so every upload was queued
 * for a worker that rejects each call on a missing key: unservable, and silent
 * about it. Falling back to `none` is loud in production instead.
 */
describe('the durable provider requires its key', () => {
  it('activates when the key is present', () => {
    vi.stubEnv('FILE_SCANNER_PROVIDER', 'bouncer');
    vi.stubEnv('BOUNCER_API_KEY', 'bnc_live_abc123');

    expect(scannerConfig().provider).toBe('bouncer');
    expect(usesDurableScanner()).toBe(true);
  });

  it('falls back to none when the key is empty', () => {
    vi.stubEnv('FILE_SCANNER_PROVIDER', 'bouncer');
    vi.stubEnv('BOUNCER_API_KEY', '');

    expect(scannerConfig().provider).toBe('none');
    expect(usesDurableScanner()).toBe(false);
  });

  it('withholds the file rather than queueing it', async () => {
    vi.stubEnv('FILE_SCANNER_PROVIDER', 'bouncer');
    vi.stubEnv('BOUNCER_API_KEY', '');

    const result = await scanBytes(new Uint8Array([1]), 'file.pdf');

    // `none` in production, so this is the loud refusal rather than a file
    // sitting `pending` for a worker that can never clear it.
    expect(result.verdict).toBe('failed');
  });
});
