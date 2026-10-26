import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  scannerConfigurationCheck,
  scannerReadinessChecks,
} from '../../../scripts/scanner-readiness';
import type { ScannerConfig } from '@/lib/files/scanner';

const url = 'https://scanner.example.invalid/scan?key=private-test-value';
const config: ScannerConfig = {
  provider: 'clamav',
  url,
  apiKey: 'private-api-key',
  timeoutMs: 1000,
};
const valid = () => scannerConfigurationCheck('clamav', url, true);
afterEach(() => vi.unstubAllGlobals());

describe('scanner configuration readiness', () => {
  it.each([
    ['clamav', ''],
    ['clamav', '   '],
    ['clamav', 'not-a-url'],
    ['clamav', 'http://scanner.example.invalid'],
    ['clamav', 'ftp://scanner.example.invalid'],
    ['clamav', 'https://user:private@scanner.example.invalid'],
    ['clamav', 'https://scanner.example.invalid/#private'],
    ['clamav', ' https://scanner.example.invalid'],
    ['none', url],
    ['misspelled', url],
    ['', url],
  ])(
    'refuses unusable production configuration (%s, %s)',
    (provider, endpoint) => {
      const result = scannerConfigurationCheck(provider, endpoint, true);
      expect(result.status).toBe('fail');
      expect(result.detail).not.toContain('private');
      if (endpoint.trim()) expect(result.detail).not.toContain(endpoint);
    },
  );

  it.each([undefined, 'clamav'])(
    'accepts the application default and explicit ClamAV (%s)',
    (provider) => {
      const result = scannerConfigurationCheck(provider, url, true);
      expect(result.status).toBe('pass');
      expect(result.detail).not.toContain(url);
      expect(result.detail).toContain('separate probes');
    },
  );

  it('allows HTTP only outside production', () => {
    expect(
      scannerConfigurationCheck('clamav', 'http://127.0.0.1:3000/scan', false)
        .status,
    ).toBe('pass');
  });
});

describe('scanner readiness through the upload adapter', () => {
  it('requires both an accepted harmless control and an infected EICAR control', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (endpoint: string, init: RequestInit) => {
        expect(endpoint).toBe(url);
        expect(init.redirect).toBe('error');
        expect(init.headers).toEqual({
          Authorization: 'Bearer private-api-key',
        });
        const file = (init.body as FormData).get('file') as File;
        const body = await file.text();
        bodies.push(body);
        return new Response(
          body.includes('EICAR-STANDARD')
            ? 'stream: Eicar FOUND'
            : 'stream: OK',
          { status: 200 },
        );
      }),
    );
    const result = await scannerReadinessChecks(valid(), config);
    expect(result.clean.status).toBe('pass');
    expect(result.eicar.status).toBe('pass');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toContain('readiness control');
    expect(bodies[1]).toHaveLength(68);
  });

  it('fails a scanner that reports every file as infected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('stream: Eicar FOUND', { status: 406 })),
    );
    const result = await scannerReadinessChecks(valid(), config);
    expect(result.clean.status).toBe('fail');
    expect(result.eicar.status).toBe('pass');
  });

  it('fails a scanner that reports every file as clean', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('OK')),
    );
    const result = await scannerReadinessChecks(valid(), config);
    expect(result.clean.status).toBe('pass');
    expect(result.eicar.status).toBe('fail');
  });

  it.each(['none', 'misspelled', ''])(
    'does not contact an unusable provider (%s)',
    async (provider) => {
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      const result = await scannerReadinessChecks(
        scannerConfigurationCheck(provider, url, true),
        config,
      );
      expect(fetcher).not.toHaveBeenCalled();
      expect(result.clean.status).toBe('unknown');
      expect(result.eicar.status).toBe('unknown');
    },
  );

  it('does not transmit the API key to a production HTTP endpoint', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const endpoint = 'http://scanner.example.invalid';
    await scannerReadinessChecks(
      scannerConfigurationCheck('clamav', endpoint, true),
      { ...config, url: endpoint },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [200, 'x'.repeat(5000) + ': Eicar FOUND'],
    [200, '<html>private-key-in-error</html>'],
    [500, 'stream: Eicar FOUND'],
    [302, 'stream: Eicar FOUND'],
    [200, 'stream: OK\nstream: Eicar FOUND'],
  ])('does not certify an unusable reply (%s)', async (status, body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status })),
    );
    const result = await scannerReadinessChecks(valid(), config);
    expect(result.clean.status).toBe('unknown');
    expect(result.eicar.status).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain(body);
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('keeps transport errors unknown without echoing the destination or secret', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('unreachable ' + url);
      }),
    );
    const result = await scannerReadinessChecks(valid(), config);
    expect(result.clean.status).toBe('unknown');
    expect(result.eicar.status).toBe('unknown');
    expect(JSON.stringify(result)).not.toContain(url);
  });
});
