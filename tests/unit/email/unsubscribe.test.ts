import { beforeAll, describe, expect, it } from 'vitest';

import {
  mintUnsubscribeToken,
  unsubscribeHeaders,
  verifyUnsubscribeToken,
} from '@/lib/email/unsubscribe';

beforeAll(() => {
  process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';
});

const USER = '11111111-1111-4111-8111-111111111111';

describe('unsubscribe tokens', () => {
  it('round-trips a user and scope', () => {
    const token = mintUnsubscribeToken(USER, 'alerts');
    expect(verifyUnsubscribeToken(token)).toEqual({
      userId: USER,
      scope: 'alerts',
    });
  });

  it('defaults to unsubscribing everything', () => {
    expect(verifyUnsubscribeToken(mintUnsubscribeToken(USER))?.scope).toBe(
      'all',
    );
  });

  it('rejects a tampered payload', () => {
    const token = mintUnsubscribeToken(USER, 'alerts');
    const [payload, signature] = token.split('.');
    const otherUser = Buffer.from(
      '22222222-2222-4222-8222-222222222222.alerts',
      'utf8',
    ).toString('base64url');

    expect(verifyUnsubscribeToken(`${otherUser}.${signature}`)).toBeNull();
    expect(payload).toBeTruthy();
  });

  it('rejects a tampered signature', () => {
    const token = mintUnsubscribeToken(USER, 'alerts');
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull();
  });

  it('rejects malformed input rather than throwing', () => {
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken('nodots')).toBeNull();
    expect(verifyUnsubscribeToken('.')).toBeNull();
  });

  it('rejects an unknown scope', () => {
    const payload = Buffer.from(`${USER}.everything`, 'utf8').toString(
      'base64url',
    );
    // Signed correctly but with a scope the code does not accept.
    const token = mintUnsubscribeToken(USER, 'all');
    const signature = token.split('.')[1];
    expect(verifyUnsubscribeToken(`${payload}.${signature}`)).toBeNull();
  });

  it('a token minted under a different secret does not verify', () => {
    const token = mintUnsubscribeToken(USER, 'alerts');
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'rotated-secret';
    expect(verifyUnsubscribeToken(token)).toBeNull();
    process.env.EMAIL_UNSUBSCRIBE_SECRET = 'test-unsubscribe-secret';
  });

  it('emits the RFC 8058 one-click headers', () => {
    const headers = unsubscribeHeaders(
      'https://example.com/',
      mintUnsubscribeToken(USER, 'alerts'),
    );
    expect(headers['List-Unsubscribe']).toMatch(
      /^<https:\/\/example\.com\/api\/v1\/unsubscribe\?token=.+>$/,
    );
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});
