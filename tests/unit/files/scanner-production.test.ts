import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/env', () => ({ isProduction: true }));
import { scanBytes, scannerConfig } from '@/lib/files/scanner';

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
