import { describe, expect, it } from 'vitest';

import {
  isDownloadable,
  scanBytes,
  type ScannerConfig,
} from '@/lib/files/scanner';
import { safeFileName } from '@/lib/files/attachments';

const NONE: ScannerConfig = {
  provider: 'none',
  url: '',
  apiKey: '',
  timeoutMs: 1000,
};

describe('scanBytes with no scanner configured', () => {
  it('returns skipped, never clean', async () => {
    // The distinction is the whole point: `clean` would assert something we
    // did not check, and the read policy treats the two differently.
    const outcome = await scanBytes(new Uint8Array([1, 2, 3]), 'x.pdf', NONE);
    expect(outcome.verdict).toBe('skipped');
    expect(outcome.scanner).toBe('none');
    expect(outcome.detail).toContain('No scanner configured');
  });
});

describe('isDownloadable', () => {
  it('allows only the two resolved-safe states', () => {
    expect(isDownloadable('clean')).toBe(true);
    expect(isDownloadable('skipped')).toBe(true);
  });

  it('withholds anything unresolved or rejected', () => {
    for (const state of ['pending', 'scanning', 'failed', 'infected', '']) {
      expect(isDownloadable(state)).toBe(false);
    }
  });
});

describe('safeFileName', () => {
  it('keeps an ordinary name and its extension intact', () => {
    expect(safeFileName('tax-sale-notice.pdf')).toBe('tax-sale-notice.pdf');
  });

  it('strips directory traversal', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('..\\..\\windows\\system32\\config')).toBe('config');
  });

  it('never returns a name that starts with a dot or a hyphen', () => {
    // A leading dot hides the file; a leading hyphen can be read as a flag by
    // whatever command an operator eventually points at it.
    expect(safeFileName('.htaccess').startsWith('.')).toBe(false);
    expect(safeFileName('---weird.csv').startsWith('-')).toBe(false);
  });

  it('removes characters that could split a Content-Disposition header', () => {
    const result = safeFileName('bad"name\r\nX-Injected: 1.pdf');
    expect(result).not.toContain('"');
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
    expect(result.endsWith('.pdf')).toBe(true);
  });

  it('always yields something non-empty', () => {
    expect(safeFileName('')).toBe('attachment');
    expect(safeFileName('///')).toBe('attachment');
    expect(safeFileName('...')).toBe('attachment');
  });

  it('bounds the length', () => {
    expect(safeFileName(`${'a'.repeat(400)}.pdf`).length).toBeLessThanOrEqual(
      120,
    );
  });
});
