import { describe, expect, it, vi } from 'vitest';

import { emailDnsCheck } from '../../../scripts/email-dns';

const options = {
  from: 'Ledger <alerts@example.com>',
  provider: 'resend',
};
const spf = ['v=spf1 include:example.net ~all'];
const dmarc = ['v=DMARC1; p=none;'];

function dns(records: Record<string, string[][] | string>) {
  return vi.fn(async (name: string): Promise<string[][]> => {
    const value = records[name] ?? 'ENODATA';
    if (typeof value === 'string')
      throw Object.assign(new Error(value), { code: value });
    return value;
  });
}

describe('email DNS readiness', () => {
  it('accepts Resend return-path SPF even when the From domain has no TXT records', async () => {
    // resolveTxt follows the sending CNAME and returns its provider-managed TXT.
    const resolver = dns({
      'send.example.com': [spf],
      '_dmarc.example.com': [dmarc],
    });
    const result = await emailDnsCheck(options, resolver);
    expect(result.status).toBe('pass');
    expect(resolver).not.toHaveBeenCalledWith('example.com');
    expect(result.detail).toContain('send.example.com');
    expect(result.detail).toContain('DKIM and delivery are not verified');
  });

  it('does not use root SPF to conceal a missing return-path record', async () => {
    const result = await emailDnsCheck(
      options,
      dns({
        'example.com': [spf],
        '_dmarc.example.com': [dmarc],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('SPF at send.example.com');
  });

  it("uses a custom return-path domain without guessing another provider's setting", async () => {
    const resolver = dns({
      'bounce.example.com': [spf],
      '_dmarc.example.com': [dmarc],
    });
    expect(
      (
        await emailDnsCheck(
          {
            ...options,
            provider: 'postmark',
            returnPathDomain: 'bounce.example.com',
          },
          resolver,
        )
      ).status,
    ).toBe('pass');
    expect(resolver).not.toHaveBeenCalledWith('example.com');
  });

  it('honors a custom Resend return path and normalizes a trailing DNS dot', async () => {
    const resolver = dns({
      'outbound.example.com': [spf],
      '_dmarc.example.com': [dmarc],
    });
    expect(
      (
        await emailDnsCheck(
          { ...options, returnPathDomain: ' OUTBOUND.EXAMPLE.COM. ' },
          resolver,
        )
      ).status,
    ).toBe('pass');
  });

  it('does not guess the return path for a provider without a default', async () => {
    const resolver = dns({
      'example.com': [spf],
      '_dmarc.example.com': [dmarc],
    });
    const result = await emailDnsCheck(
      { ...options, provider: 'postmark' },
      resolver,
    );
    expect(result.status).toBe('unknown');
    expect(result.detail).toContain('EMAIL_RETURN_PATH_DOMAIN');
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each(['ENODATA', 'ENOTFOUND'])(
    'reports an authoritative %s answer as missing SPF',
    async (code) => {
      const result = await emailDnsCheck(
        options,
        dns({ 'send.example.com': code, '_dmarc.example.com': [dmarc] }),
      );
      expect(result.status).toBe('fail');
      expect(result.detail).toContain('SPF at send.example.com');
    },
  );

  it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED'])(
    'reports %s as unknown instead of missing',
    async (code) => {
      const result = await emailDnsCheck(
        options,
        dns({ 'send.example.com': code, '_dmarc.example.com': [dmarc] }),
      );
      expect(result.status).toBe('unknown');
      expect(result.detail).toContain(code);
      expect(result.detail).not.toContain('missing:');
    },
  );

  it('keeps an unavailable DMARC lookup unknown', async () => {
    const result = await emailDnsCheck(
      options,
      dns({ 'send.example.com': [spf], '_dmarc.example.com': 'ETIMEOUT' }),
    );
    expect(result.status).toBe('unknown');
    expect(result.detail).toContain('_dmarc.example.com');
  });

  it('joins TXT fragments and checks DMARC on the visible From domain', async () => {
    const result = await emailDnsCheck(
      options,
      dns({
        'send.example.com': [['v=spf1 ', 'include:example.net ~all']],
        '_dmarc.example.com': [['v=DMARC1;', ' p=none;']],
      }),
    );
    expect(result.status).toBe('pass');
  });

  it('does not mistake a different version prefix for an SPF record', async () => {
    const result = await emailDnsCheck(
      options,
      dns({
        'send.example.com': [['v=spf10 ~all']],
        '_dmarc.example.com': [dmarc],
      }),
    );
    expect(result.status).toBe('fail');
  });

  it('rejects multiple SPF records instead of reporting valid configuration', async () => {
    const result = await emailDnsCheck(
      options,
      dns({
        'send.example.com': [spf, ['v=spf1 -all']],
        '_dmarc.example.com': [dmarc],
      }),
    );
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('multiple SPF');
  });

  it('reports missing DMARC even when SPF is present', async () => {
    const result = await emailDnsCheck(
      options,
      dns({ 'send.example.com': [spf] }),
    );
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('DMARC at _dmarc.example.com');
  });

  it('leaves an absent From address unknown without querying DNS', async () => {
    const resolver = dns({});
    expect(
      (await emailDnsCheck({ ...options, from: '' }, resolver)).status,
    ).toBe('unknown');
    expect(resolver).not.toHaveBeenCalled();
  });
});
