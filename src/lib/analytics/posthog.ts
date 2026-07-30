import { publicEnv } from '@/lib/env';

/**
 * PostHog capture, server-side, without `posthog-js`.
 *
 * Events are already written first-party to `analytics_events` — that table is
 * what the admin dashboard reads and what survives a vendor change. This
 * forwards the same event to PostHog for funnel and cohort analysis, using its
 * plain JSON capture endpoint.
 *
 * Sending from the server rather than the browser has two advantages worth the
 * loss of automatic pageview tracking: ad blockers cannot silently drop a
 * subscription-purchased event, and the properties that reach PostHog are the
 * scrubbed ones, so a client bug cannot leak member-entered text into a
 * third-party analytics store.
 */
export async function captureToPostHog(
  event: string,
  distinctId: string,
  properties: Record<string, string | number | boolean | null>,
): Promise<void> {
  const key = publicEnv.posthogKey;
  if (!key) return;

  const host = (publicEnv.posthogHost || 'https://us.i.posthog.com').replace(
    /\/$/,
    '',
  );

  try {
    await fetch(`${host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: distinctId,
        properties: {
          ...properties,
          environment: publicEnv.environment,
          $lib: 'georgia-opportunity-ledger-server',
        },
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    // Analytics must never break the request it is describing.
    console.warn('[analytics] PostHog capture failed', {
      event,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
