import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { scanBytes, type ScannerConfig } from '@/lib/files/scanner';

/**
 * The ClamAV provider's HTTP path.
 *
 * `scanWithClamav` shipped untested: the unit tests covered only the `none`
 * provider, so the multipart encoding, the 406 convention, the "FOUND" body
 * convention and the timeout had never run. Verifying it by hand against a real
 * ClamAV proved it works — and left no artefact, which is how the last few
 * unexercised things in this repository came to be unexercised.
 *
 * So the engine is replaced by a stub that speaks the same two conventions,
 * and the assertions are about the client rather than about ClamAV. A real
 * engine confirms the signatures; this confirms we ask it correctly and read
 * its answer correctly, which is the part that lives in this repository.
 *
 * The EICAR string is the industry-standard harmless test file. It is inert —
 * it is a *signature* every scanner agrees to flag, not code that does
 * anything — and it appears here only so the stub has something recognisable
 * to react to.
 */

const EICAR =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

/** Extracts the uploaded part, so the test can assert the bytes survived. */
function extractPart(raw: Buffer, contentType: string): Buffer {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const boundary = (match?.[1] ?? match?.[2] ?? '').trim();
  if (!boundary) return raw;

  const delim = Buffer.from(`--${boundary}`);
  const start = raw.indexOf(delim);
  if (start < 0) return raw;
  const headEnd = raw.indexOf('\r\n\r\n', start);
  if (headEnd < 0) return raw;

  const bodyStart = headEnd + 4;
  const next = raw.indexOf(delim, bodyStart);
  return raw.subarray(bodyStart, next < 0 ? raw.length : next - 2);
}

interface Stub {
  server: Server;
  url: string;
  /** Exactly what the last request delivered, for the round-trip assertion. */
  lastBody: Buffer | null;
}

const stub: Stub = {
  server: null as unknown as Server,
  url: '',
  lastBody: null,
};

beforeAll(async () => {
  stub.server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = extractPart(
        Buffer.concat(chunks),
        request.headers['content-type'] ?? '',
      );
      stub.lastBody = body;

      if (request.url?.includes('slow')) return; // never answers: timeout path
      if (request.url?.includes('broken')) {
        response.writeHead(500);
        response.end('scanner exploded');
        return;
      }

      const text = body.toString('binary');
      if (text.includes('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) {
        // clamav-rest answers 406 for a hit, with the signature in the body.
        response.writeHead(406, { 'content-type': 'text/plain' });
        response.end('upload.bin: Test-Signature.UNOFFICIAL FOUND');
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('OK');
    });
  });

  await new Promise<void>((resolve) => {
    stub.server.listen(0, '127.0.0.1', resolve);
  });
  const address = stub.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  stub.url = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => stub.server.close(() => resolve()));
});

function config(path = '/scan', timeoutMs = 5000): ScannerConfig {
  return {
    provider: 'clamav',
    url: `${stub.url}${path}`,
    apiKey: '',
    timeoutMs,
  };
}

describe('the ClamAV provider', () => {
  it('delivers the file unaltered', async () => {
    // A scanner is worthless if the multipart encoding corrupts what it sees.
    // This exact defect made an earlier manual check report a known-bad file
    // as clean, so the byte count is asserted rather than assumed.
    const bytes = new Uint8Array(Buffer.from(EICAR, 'binary'));
    await scanBytes(bytes, 'eicar.com', config());

    expect(stub.lastBody?.length).toBe(bytes.length);
    expect(stub.lastBody?.toString('binary')).toBe(EICAR);
  });

  it('reads a 406 with a signature name as infected', async () => {
    const outcome = await scanBytes(
      new Uint8Array(Buffer.from(EICAR, 'binary')),
      'eicar.com',
      config(),
    );

    expect(outcome.verdict).toBe('infected');
    expect(outcome.scanner).toBe('clamav');
    expect(outcome.detail).toContain('FOUND');
  });

  it('reads a 200 as clean', async () => {
    const outcome = await scanBytes(
      new Uint8Array(Buffer.from('%PDF-1.4 harmless', 'binary')),
      'clean.pdf',
      config(),
    );

    expect(outcome.verdict).toBe('clean');
    expect(outcome.detail).toBeNull();
  });

  it('fails rather than passing when the scanner errors', async () => {
    const outcome = await scanBytes(
      new Uint8Array([1, 2, 3]),
      'x.pdf',
      config('/broken'),
    );

    expect(outcome.verdict).toBe('failed');
    expect(outcome.detail).toContain('500');
  });

  it('fails rather than passing when the scanner is unreachable', async () => {
    // The property that matters most: nothing turns an absent scanner into a
    // clean verdict. A `failed` file stays hidden from members and is retried.
    const outcome = await scanBytes(new Uint8Array([1, 2, 3]), 'x.pdf', {
      provider: 'clamav',
      url: 'http://127.0.0.1:1/scan',
      apiKey: '',
      timeoutMs: 2000,
    });

    expect(outcome.verdict).toBe('failed');
    expect(outcome.verdict).not.toBe('clean');
  });

  it('fails rather than hanging when the scanner does not answer', async () => {
    const outcome = await scanBytes(
      new Uint8Array([1, 2, 3]),
      'x.pdf',
      config('/slow', 300),
    );

    expect(outcome.verdict).toBe('failed');
    expect(outcome.detail).toMatch(/did not answer/i);
  });

  it('never returns clean for anything but an explicit 200', async () => {
    // Stated as its own assertion because every other verdict is recoverable
    // and this one is not: `clean` is what makes a file downloadable.
    for (const path of ['/broken', '/slow']) {
      const outcome = await scanBytes(
        new Uint8Array([1, 2, 3]),
        'x.pdf',
        config(path, 300),
      );
      expect(outcome.verdict, path).not.toBe('clean');
    }
  });
});
