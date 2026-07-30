import { serverEnv } from '@/lib/env';

/**
 * Transactional email.
 *
 * The provider sits behind this interface so that switching vendors is a
 * config change. In development the `console` provider prints the message
 * instead of sending it, which keeps a local test run from emailing real
 * people — the failure mode that makes seed data dangerous.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Correlates the send with a notification_deliveries row. */
  tag?: string;
  replyTo?: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId: string | null;
  error?: string;
}

async function sendViaResend(
  message: EmailMessage,
  apiKey: string,
  from: string,
): Promise<SendResult> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      reply_to: message.replyTo,
      tags: message.tag ? [{ name: 'category', value: message.tag }] : undefined,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, providerMessageId: null, error: body.slice(0, 500) };
  }

  const payload = (await response.json()) as { id?: string };
  return { ok: true, providerMessageId: payload.id ?? null };
}

async function sendViaPostmark(
  message: EmailMessage,
  apiKey: string,
  from: string,
): Promise<SendResult> {
  const response = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      From: from,
      To: message.to,
      Subject: message.subject,
      HtmlBody: message.html,
      TextBody: message.text,
      ReplyTo: message.replyTo,
      MessageStream: 'outbound',
      Tag: message.tag,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { ok: false, providerMessageId: null, error: body.slice(0, 500) };
  }

  const payload = (await response.json()) as { MessageID?: string };
  return { ok: true, providerMessageId: payload.MessageID ?? null };
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const env = serverEnv();

  if (env.emailProvider === 'console' || !env.emailApiKey) {
    console.info('[email] (not sent — console provider)', {
      to: message.to,
      subject: message.subject,
      tag: message.tag,
      preview: message.text.slice(0, 200),
    });
    return { ok: true, providerMessageId: `console-${Date.now()}` };
  }

  const from = env.emailFrom;
  const withReplyTo = { ...message, replyTo: message.replyTo ?? env.emailReplyTo };

  try {
    return env.emailProvider === 'postmark'
      ? await sendViaPostmark(withReplyTo, env.emailApiKey, from)
      : await sendViaResend(withReplyTo, env.emailApiKey, from);
  } catch (error) {
    return {
      ok: false,
      providerMessageId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
