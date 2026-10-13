import { createHash } from 'node:crypto';
import type { EmailMessage, SendResult } from '@/lib/email/client';
import { unsubscribeHeaders } from '@/lib/email/unsubscribe';
import { publicEnv, serverEnv } from '@/lib/env';

/** Persist this envelope before contacting a provider. Never rebuild a retry. */
export interface PreparedEmail {
  provider: 'resend' | 'postmark' | 'console';
  recipient: string;
  body: Record<string, unknown>;
}

export function prepareEmail(message: EmailMessage): PreparedEmail {
  const env = serverEnv();
  const headers = message.unsubscribeToken
    ? unsubscribeHeaders(publicEnv.siteUrl, message.unsubscribeToken)
    : undefined;
  const replyTo = message.replyTo ?? env.emailReplyTo;
  return {
    provider: env.emailProvider,
    recipient: message.to,
    body:
      env.emailProvider === 'postmark'
        ? {
            From: env.emailFrom,
            To: message.to,
            Subject: message.subject,
            HtmlBody: message.html,
            TextBody: message.text,
            ReplyTo: replyTo,
            MessageStream: 'outbound',
            Tag: message.tag,
            Headers: headers
              ? Object.entries(headers).map(([Name, Value]) => ({
                  Name,
                  Value,
                }))
              : undefined,
          }
        : {
            from: env.emailFrom,
            to: [message.to],
            subject: message.subject,
            html: message.html,
            text: message.text,
            reply_to: replyTo,
            headers,
            tags: message.tag
              ? [{ name: 'category', value: message.tag }]
              : undefined,
          },
  };
}

export function deliveryCredentials(): {
  provider: string;
  fingerprint: string;
} {
  const env = serverEnv();
  if (
    env.emailProvider === 'console' &&
    publicEnv.environment === 'production'
  ) {
    throw new Error('Production email requires a sending provider.');
  }
  if (env.emailProvider !== 'console' && !env.emailApiKey.trim()) {
    throw new Error('Email delivery API key is missing.');
  }
  return {
    provider: env.emailProvider,
    fingerprint: createHash('sha256')
      .update(`${env.emailProvider}:${env.emailApiKey}`)
      .digest('hex'),
  };
}

export async function sendPreparedEmail(
  email: PreparedEmail,
  idempotencyKey: string,
): Promise<SendResult & { needsReview?: boolean }> {
  const env = serverEnv();
  if (env.emailProvider !== email.provider) {
    return {
      ok: false,
      providerMessageId: null,
      error: 'The queued email provider changed.',
      needsReview: true,
    };
  }
  deliveryCredentials();
  if (email.provider === 'console') {
    console.info('[email] queued development preview', { idempotencyKey });
    return { ok: true, providerMessageId: `console-${idempotencyKey}` };
  }
  const resend = email.provider === 'resend';
  try {
    const response = await fetch(
      resend
        ? 'https://api.resend.com/emails'
        : 'https://api.postmarkapp.com/email',
      {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
        headers: resend
          ? {
              Authorization: `Bearer ${env.emailApiKey}`,
              'Content-Type': 'application/json',
              'Idempotency-Key': idempotencyKey,
            }
          : {
              'X-Postmark-Server-Token': env.emailApiKey,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
        body: JSON.stringify(email.body),
      },
    );
    const payload = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const id = payload?.[resend ? 'id' : 'MessageID'];
    if (response.ok && typeof id === 'string' && id.length > 0)
      return { ok: true, providerMessageId: id };
    return {
      ok: false,
      providerMessageId: null,
      error: `Email provider returned HTTP ${response.status} without a confirmed message ID.`,
      // A Postmark request cannot be replayed safely after an uncertain outcome.
      // Resend's payload/key mismatch and permanent request errors need repair.
      needsReview:
        !resend ||
        (response.status >= 400 &&
          response.status < 500 &&
          response.status !== 429 &&
          payload?.name !== 'concurrent_idempotent_requests'),
    };
  } catch (error) {
    return {
      ok: false,
      providerMessageId: null,
      error: error instanceof Error ? error.message : String(error),
      needsReview: !resend,
    };
  }
}
