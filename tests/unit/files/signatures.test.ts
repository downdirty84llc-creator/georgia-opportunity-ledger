import { describe, expect, it } from 'vitest';

import {
  ALLOWED_MIME_TYPES,
  isAllowedMimeType,
  sniffMimeType,
} from '@/lib/files/signatures';

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((character) => character.charCodeAt(0)));
}

const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const XLSX = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);

function webp(): Uint8Array {
  const buffer = new Uint8Array(16);
  buffer.set(ascii('RIFF'), 0);
  buffer.set(ascii('WEBP'), 8);
  return buffer;
}

describe('isAllowedMimeType', () => {
  it('accepts exactly the six documented types', () => {
    expect(ALLOWED_MIME_TYPES).toHaveLength(6);
    for (const type of ALLOWED_MIME_TYPES) {
      expect(isAllowedMimeType(type)).toBe(true);
    }
  });

  it('rejects the types an attacker would reach for first', () => {
    for (const type of [
      'text/html',
      'image/svg+xml',
      'application/x-msdownload',
      'application/octet-stream',
      '',
    ]) {
      expect(isAllowedMimeType(type)).toBe(false);
    }
  });
});

describe('sniffMimeType', () => {
  it('accepts each binary format with its real signature', () => {
    expect(sniffMimeType('application/pdf', PDF).ok).toBe(true);
    expect(sniffMimeType('image/png', PNG).ok).toBe(true);
    expect(sniffMimeType('image/jpeg', JPEG).ok).toBe(true);
    expect(sniffMimeType('image/webp', webp()).ok).toBe(true);
    expect(
      sniffMimeType(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        XLSX,
      ).ok,
    ).toBe(true);
  });

  it('rejects HTML dressed up as a PNG', () => {
    // The stored-XSS case: the browser would sniff this as markup if it were
    // ever served inline from the storage origin.
    const result = sniffMimeType(
      'image/png',
      ascii('<html><script>alert(1)</script></html>'),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it('rejects a signature that belongs to a different accepted type', () => {
    // Both are allowed types, so the allowlist alone would wave this through.
    expect(sniffMimeType('application/pdf', PNG).ok).toBe(false);
    expect(sniffMimeType('image/png', PDF).ok).toBe(false);
  });

  it('rejects a truncated signature rather than reading past the end', () => {
    expect(sniffMimeType('image/png', bytes(0x89, 0x50)).ok).toBe(false);
    // RIFF header present but too short to carry the WEBP marker.
    expect(sniffMimeType('image/webp', ascii('RIFF')).ok).toBe(false);
  });

  it('rejects an empty file whatever it claims to be', () => {
    for (const type of ALLOWED_MIME_TYPES) {
      expect(sniffMimeType(type, new Uint8Array()).ok).toBe(false);
    }
  });

  it('accepts a real CSV, including one with a formula-looking cell', () => {
    // Escaping that cell is the CSV writer's job, not the sniffer's; refusing
    // the upload here would reject legitimate spreadsheets.
    expect(sniffMimeType('text/csv', ascii('name,score\nSite A,88\n')).ok).toBe(
      true,
    );
    expect(sniffMimeType('text/csv', ascii('a,b\n=SUM(1),2\n')).ok).toBe(true);
  });

  it('rejects markup or binary content renamed to .csv', () => {
    expect(sniffMimeType('text/csv', ascii('<!DOCTYPE html><p>hi')).ok).toBe(
      false,
    );
    expect(sniffMimeType('text/csv', ascii('<svg onload=alert(1)>')).ok).toBe(
      false,
    );
    expect(sniffMimeType('text/csv', bytes(0x61, 0x00, 0x62, 0x00)).ok).toBe(
      false,
    );
  });

  it('rejects a type outside the allowlist even with matching bytes', () => {
    expect(sniffMimeType('image/gif', ascii('GIF89a')).ok).toBe(false);
  });
});
