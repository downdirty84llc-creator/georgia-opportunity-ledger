import {
  featuresForRank,
  parsePlanFeatures,
  type PlanCode,
  type PlanFeatures,
} from '@/lib/access/ranks';
import type { AlertRecipient } from '@/lib/alerts/matching';
import {
  effectiveAccessRank,
  type AccountStatus,
  type SubscriptionStatus,
  type UserRole,
} from '@/lib/billing/subscription';
import { createAdminClient } from '@/lib/db/admin';
import { memberEmailAddresses } from '@/lib/email/outbox';
import { parseStoredFilters } from '@/lib/search/filters';

export interface EmailRecipient extends AlertRecipient {
  email: string;
  firstName: string | null;
  features: PlanFeatures;
  preferredCountyIds: string[];
}
export async function loadRecipientPage(
  now: Date,
  options: { after?: string; before?: string; ids?: readonly string[] } = {},
): Promise<{
  recipients: EmailRecipient[];
  nextAfter: string | null;
  hasMore: boolean;
}> {
  const supabase = createAdminClient();

  // A single view-shaped query rather than N+1 per member.
  let query = supabase
    .from('profiles')
    .select(
      `
      id, role, account_status, first_name,
      access_rank_override, access_rank_override_expires_at,
      user_preferences ( email_alerts_enabled, minimum_score,
                         preferred_county_ids, preferred_industry_ids ),
      subscriptions ( status, stripe_subscription_id, paid_through_at, current_period_end, cancel_at_period_end,
                      subscription_plans ( code, access_rank,
                                           feature_configuration ) ),
      alert_preferences ( alert_type, enabled, frequency, delivery_method )
    `,
    )
    .eq('account_status', 'active')
    .order('id', { ascending: true })
    .limit(25);
  if (options.after) query = query.gt('id', options.after);
  if (options.before) query = query.lte('created_at', options.before);
  if (options.ids) query = query.in('id', options.ids);
  const { data, error } = await query;

  if (error) throw new Error(error.message);

  const userIds = (data ?? []).map((row) => row.id);
  const emails = await memberEmailAddresses(userIds);

  const recipients: EmailRecipient[] = [];

  for (const row of data ?? []) {
    const email = emails.get(row.id);
    if (!email) continue;

    const preferences = Array.isArray(row.user_preferences)
      ? row.user_preferences[0]
      : row.user_preferences;
    const subscription = Array.isArray(row.subscriptions)
      ? row.subscriptions[0]
      : row.subscriptions;
    const plan = subscription
      ? Array.isArray(subscription.subscription_plans)
        ? subscription.subscription_plans[0]
        : subscription.subscription_plans
      : null;

    const accessRank = effectiveAccessRank(
      {
        role: row.role as UserRole,
        accountStatus: row.account_status as AccountStatus,
        accessRankOverride: row.access_rank_override,
        accessRankOverrideExpiresAt: row.access_rank_override_expires_at
          ? new Date(row.access_rank_override_expires_at)
          : null,
      },
      subscription
        ? {
            status: subscription.status as SubscriptionStatus,
            paidThrough: subscription.stripe_subscription_id
              ? subscription.paid_through_at
                ? new Date(subscription.paid_through_at)
                : null
              : undefined,
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end)
              : null,
            cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            planAccessRank: plan?.access_rank ?? 0,
          }
        : null,
      now,
    );

    const features =
      accessRank < 100 &&
      accessRank === (plan?.access_rank ?? 0) &&
      accessRank > 0
        ? parsePlanFeatures(
            plan?.feature_configuration,
            (plan?.code ?? 'free') as PlanCode,
          )
        : featuresForRank(accessRank);

    const disabled = new Set(
      (row.alert_preferences ?? [])
        .filter(
          (preference) =>
            preference.delivery_method === 'email' &&
            (preference.enabled === false || preference.frequency === 'never'),
        )
        .map((preference) => preference.alert_type as string),
    );

    const preferenceFilters = parseStoredFilters({
      countyIds: preferences?.preferred_county_ids ?? undefined,
      industryIds: preferences?.preferred_industry_ids ?? undefined,
    });

    recipients.push({
      userId: row.id,
      email,
      firstName: row.first_name,
      features,
      preferredCountyIds: preferences?.preferred_county_ids ?? [],
      accessRank,
      accountStatus: row.account_status as AccountStatus,
      emailAlertsEnabled: preferences?.email_alerts_enabled ?? true,
      immediateAlertsEntitled: features.immediateAlerts,
      minimumScore: preferences?.minimum_score ?? 0,
      filters: preferenceFilters,
      disabledAlertTypes: disabled,
      deliveredKeys: new Set<string>(),
    });
  }

  return {
    recipients,
    nextAfter: data?.[data.length - 1]?.id ?? null,
    hasMore: data?.length === 25,
  };
}

export async function queuedNotificationKeys(
  userId: string,
  keys: readonly string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let offset = 0; offset < keys.length; offset += 50) {
    const { data, error } = await createAdminClient()
      .from('notifications')
      .select('dedupe_key')
      .eq('user_id', userId)
      .in('dedupe_key', keys.slice(offset, offset + 50));
    if (error)
      throw new Error(`Could not inspect notification keys: ${error.message}`);
    for (const row of data ?? [])
      if (row.dedupe_key) existing.add(row.dedupe_key);
  }
  return existing;
}
