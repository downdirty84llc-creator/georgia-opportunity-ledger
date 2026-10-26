import { describe, expect, it } from 'vitest';
import { sentryConfigurationCheck } from '../../../scripts/sentry-configuration';

describe('Sentry configuration readiness', () => {
  it.each([
    '',
    '   ',
    'not-a-dsn',
    'ftp://public@errors.example.invalid/123',
    'https://errors.example.invalid/123',
    'https://public@errors.example.invalid/',
    'https://public@errors.example.invalid/project',
    'https://public@errors.example.invalid/123\n',
  ])('refuses missing or malformed configuration (%j)', (dsn) => {
    const check = sentryConfigurationCheck(dsn);
    expect(check.status).toBe('fail');
    if (dsn) expect(check.detail).not.toContain(dsn);
  });

  it.each([
    'https://public@errors.example.invalid/123',
    'https://public@errors.example.invalid/prefix/123',
    'http://public@localhost:9000/123',
  ])(
    'distinguishes format from delivery without revealing the DSN (%s)',
    (dsn) => {
      const check = sentryConfigurationCheck(dsn);
      expect(check.status).toBe('pass');
      expect(check.detail).toContain('delivery and alert receipt not verified');
      expect(check.detail).not.toContain(dsn);
    },
  );
});
