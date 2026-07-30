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

export async function track(
  event: AnalyticsEvent,
  options: {
    userId?: string | null;
    anonymousId?: string | null;
    properties?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    const supabase = createAdminClient();
    await supabase.from('analytics_events').insert({
      user_id: options.userId ?? null,
      anonymous_id: options.anonymousId ?? null,
      event_name: event,
      properties: scrubProperties(options.properties ?? {}),
    });
  } catch (error) {
    // Analytics must never break the request it is describing.
    console.error('[analytics] failed to record event', {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
