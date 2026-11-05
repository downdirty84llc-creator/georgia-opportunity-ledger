import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * One-click unsubscribe tokens.
 *
 * An unsubscribe link that demands a login is not an unsubscribe link. Mail
 * providers increasingly require one-click unsubscribe (RFC 8058) for bulk
 * senders, and a member who cannot easily stop the email marks it as spam
 * instead — which costs the whole domain's deliverability.
 *
 * The token is an HMAC over the user id and scope, so it carries no secret and
 * cannot be forged, but also cannot be enumerated into someone else's account:
 * possession of a token only ever turns email *off*.
 */

export type UnsubscribeScope = 'alerts' | 'marketing' | 'all';

function secret(): string {
  const value =
    process.env.EMAIL_UNSUBSCRIBE_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!value) {
    throw new Error(
      'EMAIL_UNSUBSCRIBE_SECRET (or CRON_SECRET) must be set to mint unsubscribe links',
    );
  }
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function mintUnsubscribeToken(
  userId: string,
  scope: UnsubscribeScope = 'all',
): string {
  const payload = `${userId}.${scope}`;
  return `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload)}`;
}

export interface UnsubscribeClaim {
  userId: string;
  scope: UnsubscribeScope;
}

/** Decode only; callers must verify the signature or a stored complete-token hash. */
export function parseUnsubscribeClaim(token: string): UnsubscribeClaim | null {
  if (token.length > 256 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
    return null;
  const encoded = token.slice(0, token.lastIndexOf('.'));
  const payload = Buffer.from(encoded, 'base64url').toString('utf8');
  if (Buffer.from(payload, 'utf8').toString('base64url') !== encoded)
    return null;
  const parts = payload.split('.');
  if (parts.length !== 2) return null;
  const [userId, scope] = parts;
  if (!userId || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId))
    return null;
  if (scope !== 'alerts' && scope !== 'marketing' && scope !== 'all')
    return null;
  return { userId, scope };
}

export function verifyUnsubscribeToken(token: string): UnsubscribeClaim | null {
  const claim = parseUnsubscribeClaim(token);
  if (!claim) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const encodedPayload = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = sign(payload);
  const provided = Buffer.from(signature, 'utf8');
  const computed = Buffer.from(expected, 'utf8');

  if (provided.length !== computed.length) return null;
  if (!timingSafeEqual(provided, computed)) return null;

  return claim;
}

/**
 * Headers that let a mail client offer its own unsubscribe button and POST to
 * it without the member ever leaving their inbox (RFC 8058).
 */
export function unsubscribeHeaders(
  siteUrl: string,
  token: string,
): Record<string, string> {
  const base = siteUrl.replace(/\/$/, '');
  return {
    'List-Unsubscribe': `<${base}/api/v1/unsubscribe?token=${token}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}
