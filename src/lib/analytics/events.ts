import { captureToPostHog } from '@/lib/analytics/posthog';
import { createAdminClient } from '@/lib/db/admin';

/**
 * Product analytics (spec 19).
 *
 * Events are written to our own `analytics_events` table as well as being
 * forwarded to the analytics vendor by the client. Keeping a first-party copy
 * means subscription funnels survive a vendor change, and it is the table the
 * admin dashboard reads.
 *
 * Property values are scrubbed before they are stored: no email addresses, no
 * names, no free text a member typed. Spec 19 is explicit that sensitive
 * personal information must not reach analytics, and the cheapest way to keep
 * that promise is to make it structurally hard to break.
 */

export const ANALYTICS_EVENTS = [
  'account_created',
  'onboarding_completed',
  'checkout_started',
  'subscription_purchased',
  'subscription_upgraded',
  'subscription_downgraded',
  'subscription_canceled',
  'opportunity_viewed',
  'locked_content_viewed',
  'upgrade_button_clicked',
  'search_performed',
  'filter_applied',
  'opportunity_saved',
  'saved_search_created',
  'alert_opened',
  'report_opened',
  'pdf_downloaded',
  'csv_exported',
  'source_link_clicked',
  'correction_submitted',
  'support_ticket_submitted',
  'account_deletion_requested',
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/** Keys that must never carry a value into analytics storage. */
const FORBIDDEN_KEYS = new Set([
  'email',
  'first_name',
  'last_name',
  'firstName',
  'lastName',
  'phone',
  'company_name',
  'companyName',
  'password',
  'card',
  'address',
  'street_address',
  'streetAddress',
  'personal_notes',
  'personalNotes',
  'query',
  'q',
]);

export type AnalyticsProperties = Record<
  string,
  string | number | boolean | null
>;

export function scrubProperties(
  properties: Record<string, unknown>,
): AnalyticsProperties {
  const clean: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (value === null) {
      clean[key] = null;
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      // Truncate strings so a stray field cannot smuggle a paragraph of
      // member-entered text into the analytics store.
      clean[key] = typeof value === 'string' ? value.slice(0, 120) : value;
    }
  }
  return clean;
}

/**
 * Consent lookup, memoised for a short window.
 *
 * `user_preferences.analytics_enabled` has existed in the database since the
 * `analytics_consent` migration, and nothing read it — so the Privacy and
 * Cookie policies promised an opt-out that the software did not honour. The
 * column being present made it look done from the schema side, which is the
 * worst version of a missing control.
 *
 * A signed-in member generates several events per page and each would
 * otherwise cost a round trip for one boolean. The window is deliberately
 * short: someone who switches analytics off should stop being recorded within
 * seconds, not at the end of their session.
 */
const CONSENT_TTL_MS = 30_000;
const consentCache = new Map<string, { allowed: boolean; expiresAt: number }>();

export function clearAnalyticsConsentCache(): void {
  consentCache.clear();
}

async function analyticsAllowedFor(userId: string): Promise<boolean> {
  const cached = consentCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('user_preferences')
    .select('analytics_enabled')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    // Fail *closed*, unlike the rate limiter. Recording someone whose consent
    // cannot be confirmed is the outcome the policy forbids; the cost of the
    // alternative is one lost event. The preferences row is created by trigger
    // at signup, so a read failure here means the database is unwell and the
    // insert below would fail anyway.
    console.error('[analytics] consent lookup failed, not recording', {
      userId,
      error: error.message,
    });
    return false;
  }

  // A missing row counts as consent, matching the column default every
  // existing account carries.
  const allowed =
    (data as { analytics_enabled?: boolean } | null)?.analytics_enabled ?? true;

  consentCache.set(userId, { allowed, expiresAt: Date.now() + CONSENT_TTL_MS });
  return allowed;
}

export async function track(
  event: AnalyticsEvent,
  options: {
    userId?: string | null;
    anonymousId?: string | null;
    properties?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const properties = scrubProperties(options.properties ?? {});

  try {
    // Checked before anything is written or forwarded, so an opted-out member
    // reaches neither destination. The vendor is the one that matters most: it
    // sits outside our retention policy.
    if (options.userId && !(await analyticsAllowedFor(options.userId))) return;

    const supabase = createAdminClient();
    await supabase.from('analytics_events').insert({
      user_id: options.userId ?? null,
      anonymous_id: options.anonymousId ?? null,
      event_name: event,
      properties,
    });

    // Forward the already-scrubbed properties to the analytics vendor, so a
    // future change to the scrubbing rules applies to both destinations at once.
    const distinctId = options.userId ?? options.anonymousId;
    if (distinctId) {
      await captureToPostHog(event, distinctId, properties);
    }
  } catch (error) {
    // Analytics must never break the request it is describing.
    console.error('[analytics] failed to record event', {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
