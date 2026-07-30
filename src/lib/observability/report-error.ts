/**
 * Error reporting to Sentry, without the SDK.
 *
 * `@sentry/nextjs` brings a build plugin, source-map upload, an instrumentation
 * hook and a meaningful bundle cost. What this application actually needs is
 * "post the exception somewhere I will see it", and Sentry's envelope endpoint
 * accepts exactly that over plain HTTP. Sixty lines here buys the whole benefit
 * without any of the build-time machinery.
 *
 * The trade-off is real and worth stating: no automatic breadcrumbs, no
 * performance tracing, no release health, and stack frames are not mapped back
 * through the bundler. If the team later wants those, swapping this module for
 * the official SDK is a contained change — nothing outside it knows how the
 * report is delivered.
 */

import { publicEnv } from '@/lib/env';

interface ParsedDsn {
  endpoint: string;
  publicKey: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    if (!projectId || !url.username) return null;
    return {
      endpoint: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      publicKey: url.username,
    };
  } catch {
    return null;
  }
}

export interface ErrorContext {
  /** Where it happened: a route, a job name, a handler. */
  scope?: string;
  /** Anything safe to attach. Never include member-entered text. */
  tags?: Record<string, string>;
  userId?: string | null;
}

/**
 * Reports an exception. Always logs; additionally forwards to Sentry when a DSN
 * is configured. Never throws — a failure to report an error must not become a
 * second error.
 */
export async function reportError(
  error: unknown,
  context: ErrorContext = {},
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(`[error]${context.scope ? ` ${context.scope}` : ''}`, {
    message,
    stack,
    ...context.tags,
  });

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  const parsed = parseDsn(dsn);
  if (!parsed) {
    console.warn('[error] SENTRY_DSN is set but could not be parsed');
    return;
  }

  try {
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const sentAt = new Date().toISOString();

    const header = { event_id: eventId, sent_at: sentAt, dsn };
    const itemHeader = { type: 'event' };
    const payload = {
      event_id: eventId,
      timestamp: sentAt,
      platform: 'node',
      level: 'error',
      environment: publicEnv.environment,
      server_name: context.scope ?? 'georgia-opportunity-ledger',
      tags: context.tags ?? {},
      user: context.userId ? { id: context.userId } : undefined,
      exception: {
        values: [
          {
            type: error instanceof Error ? error.name : 'Error',
            value: message,
            stacktrace: stack
              ? {
                  frames: stack
                    .split('\n')
                    .slice(1, 30)
                    .map((line) => ({ filename: line.trim() }))
                    .reverse(),
                }
              : undefined,
          },
        ],
      },
    };

    const envelope = [
      JSON.stringify(header),
      JSON.stringify(itemHeader),
      JSON.stringify(payload),
    ].join('\n');

    await fetch(parsed.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': [
          'Sentry sentry_version=7',
          `sentry_key=${parsed.publicKey}`,
          'sentry_client=georgia-opportunity-ledger/0.1.0',
        ].join(', '),
      },
      body: envelope,
      // Never let error reporting hold a request open.
      signal: AbortSignal.timeout(3000),
    });
  } catch (reportingFailure) {
    console.warn('[error] could not forward to Sentry', {
      message:
        reportingFailure instanceof Error
          ? reportingFailure.message
          : String(reportingFailure),
    });
  }
}
