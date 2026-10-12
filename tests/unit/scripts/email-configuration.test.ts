import { describe, expect, it } from 'vitest';

import { emailConfigurationCheck } from '../../../scripts/email-configuration';

describe('email configuration readiness', () => {
  it.each(['resend', 'postmark'])(
    'accepts configured %s without claiming inbox delivery or revealing the key',
    (provider) => {
      const result = emailConfigurationCheck(provider, 'test-only-key');
      expect(result.status).toBe('pass');
      expect(result.detail).toContain('delivery not verified');
      expect(result.detail).not.toContain('test-only-key');
    },
  );

  it.each(['', 'console'])(
    'refuses a console/default provider even with a key (%s)',
    (provider) => {
      expect(emailConfigurationCheck(provider, 'test-only-key').status).toBe(
        'fail',
      );
    },
  );

  it.each([
    ['resend', ''],
    ['resend', ' \t '],
    ['postmark', ''],
    ['postmark', ' \t '],
  ])('refuses %s without a usable key', (provider, key) => {
    expect(emailConfigurationCheck(provider, key).status).toBe('fail');
  });

  it('refuses a provider that the sending client cannot use', () => {
    const result = emailConfigurationCheck('unsupported', 'test-only-key');
    expect(result.status).toBe('fail');
    expect(result.detail).not.toContain('test-only-key');
  });
});
