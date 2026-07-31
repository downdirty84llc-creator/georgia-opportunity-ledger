import { describe, expect, it } from 'vitest';

import {
  ASYNC_EXPORT_THRESHOLD,
  escapeCell,
  exportFileName,
  opportunityExportColumns,
  shouldGenerateAsynchronously,
  toCsv,
} from '@/lib/exports/csv';

describe('CSV escaping', () => {
  it('quotes cells containing commas, quotes and newlines', () => {
    expect(escapeCell('a,b')).toBe('"a,b"');
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('neutralises formula injection', () => {
    // These would execute in Excel/Sheets without the apostrophe prefix.
    expect(escapeCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(escapeCell('+1+2')).toBe("'+1+2");
    expect(escapeCell('@cmd')).toBe("'@cmd");
    expect(escapeCell('-2+3')).toBe("'-2+3");
  });

  it('a hostile title survives a full row round-trip', () => {
    const csv = toCsv(
      [{ title: '=HYPERLINK("http://evil","click"),and,commas' }],
      [{ header: 'Title', value: (row) => row.title }],
    );
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine?.startsWith('"\'=HYPERLINK')).toBe(true);
  });

  it('handles null, dates and objects', () => {
    expect(escapeCell(null)).toBe('');
    expect(escapeCell(undefined)).toBe('');
    expect(escapeCell(new Date('2026-07-15T00:00:00Z'))).toBe(
      '2026-07-15T00:00:00.000Z',
    );
    expect(escapeCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe('export composition', () => {
  it('uses CRLF terminators per RFC 4180', () => {
    const csv = toCsv([{ v: 1 }], [{ header: 'V', value: (row) => row.v }]);
    expect(csv).toBe('V\r\n1\r\n');
  });

  it('the export permission threshold routes large jobs async (spec 10.7)', () => {
    expect(shouldGenerateAsynchronously(ASYNC_EXPORT_THRESHOLD)).toBe(false);
    expect(shouldGenerateAsynchronously(ASYNC_EXPORT_THRESHOLD + 1)).toBe(true);
  });

  it('export columns include provenance and the sample flag', () => {
    const headers = opportunityExportColumns('https://example.com').map(
      (column) => column.header,
    );
    expect(headers).toContain('Source URL');
    expect(headers).toContain('Date verified');
    expect(headers).toContain('Sample data');
    expect(headers).toContain('Ledger link');
  });

  it('file names are sanitised', () => {
    const name = exportFileName(
      '../etc/passwd',
      new Date('2026-07-15T10:20:30Z'),
    );
    expect(name).toBe('etc-passwd-2026-07-15-10-20-30.csv');
  });
});
