import { parsePlanFeatures, type PlanCode } from '@/lib/access/ranks';
import {
  shouldSendClosingSoonAlert,
  shouldSendHighScoreAlert,
  type AlertCandidate,
  type AlertRecipient,
} from '@/lib/alerts/matching';
import {
  effectiveAccessRank,
  type AccountStatus,
  type SubscriptionStatus,
  type UserRole,
} from '@/lib/billing/subscription';
import { createAdminClient } from '@/lib/db/admin';
import { sendEmail } from '@/lib/email/client';
import {
  deadlineReminderEmail,
  premiumAlertEmail,
} from '@/lib/email/templates';
import { mintUnsubscribeToken } from '@/lib/email/unsubscribe';
import { dailyKey, type JobDefinition } from '@/lib/jobs/runner';
import { dueReminderInterval } from '@/lib/opportunities/lifecycle';
import { parseStoredFilters } from '@/lib/search/filters';
import { classifyScore } from '@/lib/scoring/score';

/**
 * Alert delivery jobs.
 *
 * Recipients are assembled once and reused across candidates, because the
 * expensive part is resolving each member's plan, preferences and already-sent
 * keys — not the matching itself.
 *
 * Nothing is sent without first inserting the notification row. The unique
 * index on `(user_id, dedupe_key)` makes that insert the lock: if it conflicts,
 * this member has already been told, and the email is skipped. A crash between
 * the insert and the send therefore loses an email rather than sending two,
 * which is the right way round for a product people pay to be alerted by.
 */

async function loadRecipients(now: Date): Promise<AlertRecipient[]> {
  const supabase = createAdminClient();

  // A single view-shaped query rather than N+1 per member.
  const { data, error } = await supabase
    .from('profiles')
    .select(
      `
      id, role, account_status, first_name,
      access_rank_override, access_rank_override_expires_at,
      user_preferences ( email_alerts_enabled, minimum_score,
                         preferred_county_ids, preferred_industry_ids ),
      subscriptions ( status, current_period_end, cancel_at_period_end,
                      subscription_plans ( code, access_rank,
                                           feature_configuration ) ),
      alert_preferences ( alert_type, enabled )
    `,
    )
    .eq('account_status', 'active')
    .limit(5000);

  if (error) throw new Error(error.message);

  const userIds = (data ?? []).map((row) => row.id);
  const emails = await loadEmails(userIds);
  const deliveredKeys = await loadDeliveredKeys(userIds);

  const recipients: AlertRecipient[] = [];

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
            currentPeriodEnd: subscription.current_period_end
              ? new Date(subscription.current_period_end)
              : null,
            cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            planAccessRank: plan?.access_rank ?? 0,
          }
        : null,
      now,
    );

    const features = parsePlanFeatures(
      plan?.feature_configuration,
      (plan?.code ?? 'free') as PlanCode,
    );

    const disabled = new Set(
      (row.alert_preferences ?? [])
        .filter((preference) => preference.enabled === false)
        .map((preference) => preference.alert_type as string),
    );

    const preferenceFilters = parseStoredFilters({
      countyIds: preferences?.preferred_county_ids ?? undefined,
      industryIds: preferences?.preferred_industry_ids ?? undefined,
    });

    recipients.push({
      userId: row.id,
      accessRank,
      accountStatus: row.account_status as AccountStatus,
      emailAlertsEnabled: preferences?.email_alerts_enabled ?? true,
      immediateAlertsEntitled: features.immediateAlerts,
      minimumScore: preferences?.minimum_score ?? 0,
      filters: preferenceFilters,
      disabledAlertTypes: disabled,
      deliveredKeys: deliveredKeys.get(row.id) ?? new Set<string>(),
    });
  }

  return recipients;
}

async function loadEmails(
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const supabase = createAdminClient();
  const emails = new Map<string, string>();
  if (userIds.length === 0) return emails;

  // Addresses live in auth.users, which is only reachable with the service key.
  const { data, error } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) {
    console.error('[jobs] could not load member addresses', error.message);
    return emails;
  }
  for (const user of data.users) {
    if (user.email) emails.set(user.id, user.email);
  }
  return emails;
}

async function loadDeliveredKeys(
  userIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const supabase = createAdminClient();
  const map = new Map<string, Set<string>>();
  if (userIds.length === 0) return map;

  const { data } = await supabase
    .from('notifications')
    .select('user_id, dedupe_key')
    .not('dedupe_key', 'is', null)
    .gte(
      'sent_at',
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    );

  for (const row of data ?? []) {
    if (!row.dedupe_key) continue;
    const set = map.get(row.user_id) ?? new Set<string>();
    set.add(row.dedupe_key);
    map.set(row.user_id, set);
  }
  return map;
}

interface CandidateRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  score: number;
  category: string;
  status: string;
  county_id: string | null;
  city_id: string | null;
  state_id: string | null;
  industry_id: string | null;
  capital_required_min: number | null;
  estimated_value_max: number | null;
  minimum_access_rank: number;
  closing_date: string | null;
  is_expired: boolean;
  verification_status: string;
  published_at: string | null;
  is_restricted: boolean;
  workflow_status: string;
  recommended_next_action: string;
  counties: { name?: string } | null;
}

function toCandidate(row: CandidateRow, versionNumber: number): AlertCandidate {
  return {
    opportunityId: row.id,
    versionNumber,
    score: row.score,
    category: row.category,
    status: row.status,
    countyId: row.county_id,
    cityId: row.city_id,
    stateId: row.state_id,
    industryIds: row.industry_id ? [row.industry_id] : [],
    propertyType: null,
    fundingType: null,
    capitalRequiredMin: row.capital_required_min,
    estimatedValueMax: row.estimated_value_max,
    minimumAccessRank: row.minimum_access_rank,
    closingDate: row.closing_date ? new Date(row.closing_date) : null,
    isExpired: row.is_expired,
    verificationStatus: row.verification_status,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    isRestricted: row.is_restricted,
    workflowStatus: row.workflow_status,
  };
}

/**
 * Claims the right to notify a member about an event. Returns false when the
 * unique dedupe index rejects the insert, meaning someone got there first.
 */
async function claimNotification(input: {
  userId: string;
  dedupeKey: string;
  notificationType: string;
  title: string;
  message: string;
  opportunityId?: string;
  reportId?: string;
  actionUrl: string;
}): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      user_id: input.userId,
      notification_type: input.notificationType,
      title: input.title,
      message: input.message,
      opportunity_id: input.opportunityId ?? null,
      report_id: input.reportId ?? null,
      action_url: input.actionUrl,
      dedupe_key: input.dedupeKey,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code !== '23505') {
      console.error('[jobs] notification insert failed', error.message);
    }
    return null;
  }
  return data.id;
}

async function recordDelivery(
  notificationId: string,
  result: { ok: boolean; providerMessageId: string | null; error?: string },
): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from('notification_deliveries').insert({
    notification_id: notificationId,
    delivery_method: 'email',
    provider_message_id: result.providerMessageId,
    delivery_status: result.ok ? 'sent' : 'failed',
    delivered_at: result.ok ? new Date().toISOString() : null,
    error_message: result.error ?? null,
  });
}

export const premiumAlertsJob: JobDefinition = {
  name: 'premium-alerts',
  description:
    'Sends immediate alerts to Premium members for newly published matching records.',
  handler: async ({ now, note }) => {
    const supabase = createAdminClient();

    // Anything published since the last successful run of this job.
    const { data: lastRun } = await supabase
      .from('job_runs')
      .select('started_at')
      .eq('job_name', 'premium-alerts')
      .eq('status', 'succeeded')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const since = lastRun?.started_at
      ? new Date(lastRun.started_at)
      : new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const { data: candidates, error } = await supabase
      .from('opportunities')
      .select(
        'id, slug, title, summary, score, category, status, county_id, city_id, ' +
          'state_id, industry_id, capital_required_min, estimated_value_max, ' +
          'minimum_access_rank, closing_date, is_expired, verification_status, ' +
          'published_at, is_restricted, workflow_status, recommended_next_action, ' +
          'counties ( name )',
      )
      .eq('workflow_status', 'published')
      .eq('is_restricted', false)
      .eq('is_expired', false)
      .gte('published_at', since.toISOString())
      .limit(500);

    if (error) throw new Error(error.message);
    if (!candidates || candidates.length === 0) {
      return {
        processed: 0,
        failed: 0,
        detail: { since: since.toISOString() },
      };
    }

    const recipients = await loadRecipients(now);
    // Addresses are fetched once for the whole run; looking them up per
    // candidate would issue one Auth API call per member per record.
    const emails = await loadEmails(recipients.map((r) => r.userId));
    note('recipientCount', recipients.length);
    note('candidateCount', candidates.length);

    let sent = 0;
    let failed = 0;

    for (const row of candidates as unknown as CandidateRow[]) {
      const candidate = toCandidate(row, 1);

      for (const recipient of recipients) {
        const decision = shouldSendHighScoreAlert(candidate, recipient);
        if (!decision.send || !decision.dedupeKey) continue;

        const notificationId = await claimNotification({
          userId: recipient.userId,
          dedupeKey: decision.dedupeKey,
          notificationType: 'opportunity_alert',
          title: row.title,
          message: row.summary.slice(0, 400),
          opportunityId: row.id,
          actionUrl: `/opportunities/${row.slug}`,
        });
        if (!notificationId) continue;

        const email = emails.get(recipient.userId);
        if (!email) continue;

        const unsubscribeToken = mintUnsubscribeToken(
          recipient.userId,
          'alerts',
        );
        const rendered = premiumAlertEmail({
          firstName: null,
          reason: 'new',
          unsubscribeToken,
          opportunity: {
            title: row.title,
            slug: row.slug,
            score: row.score,
            classification: classifyScore(row.score),
            county: row.counties?.name ?? null,
            closingDate: row.closing_date,
            whyItMatters: row.summary.slice(0, 600),
            recommendedAction: row.recommended_next_action,
          },
        });

        const result = await sendEmail({
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tag: 'premium-alert',
          unsubscribeToken,
        });
        await recordDelivery(notificationId, result);
        if (result.ok) sent += 1;
        else failed += 1;
      }
    }

    return {
      processed: sent,
      failed,
      detail: { since: since.toISOString(), candidates: candidates.length },
    };
  },
};

export const deadlineRemindersJob: JobDefinition = {
  name: 'deadline-reminders',
  description:
    'Emails members about deadlines on records they have saved, once per interval.',
  idempotencyKey: dailyKey,
  handler: async ({ now, note }) => {
    const supabase = createAdminClient();

    const { data: saved, error } = await supabase
      .from('saved_opportunities')
      .select(
        `
        user_id,
        opportunities!inner (
          id, slug, title, summary, score, category, status, county_id, city_id,
          state_id, industry_id, capital_required_min, estimated_value_max,
          minimum_access_rank, closing_date, is_expired, verification_status,
          published_at, is_restricted, workflow_status, recommended_next_action,
          counties ( name )
        )
      `,
      )
      .not('opportunities.closing_date', 'is', null)
      .eq('opportunities.is_expired', false)
      .limit(5000);

    if (error) throw new Error(error.message);

    const recipients = new Map(
      (await loadRecipients(now)).map((recipient) => [
        recipient.userId,
        recipient,
      ]),
    );
    const emails = await loadEmails([...recipients.keys()]);

    // Group by member and reminder interval so one member gets one email
    // listing everything closing at that horizon, not one email per record.
    const grouped = new Map<
      string,
      Map<
        number,
        Array<{
          title: string;
          slug: string;
          closingDate: string;
          score: number;
          dedupeKey: string;
          opportunityId: string;
        }>
      >
    >();

    for (const entry of saved ?? []) {
      const recipient = recipients.get(entry.user_id);
      if (!recipient) continue;

      const row = (Array.isArray(entry.opportunities)
        ? entry.opportunities[0]
        : entry.opportunities) as unknown as CandidateRow | undefined;
      if (!row?.closing_date) continue;

      const candidate = toCandidate(row, 1);
      const decision = shouldSendClosingSoonAlert(candidate, recipient, now);
      if (!decision.send || !decision.dedupeKey) continue;

      const interval = dueReminderInterval(new Date(row.closing_date), now);
      if (interval === null) continue;

      const byInterval = grouped.get(entry.user_id) ?? new Map();
      const list = byInterval.get(interval) ?? [];
      list.push({
        title: row.title,
        slug: row.slug,
        closingDate: row.closing_date,
        score: row.score,
        dedupeKey: decision.dedupeKey,
        opportunityId: row.id,
      });
      byInterval.set(interval, list);
      grouped.set(entry.user_id, byInterval);
    }

    note('membersWithReminders', grouped.size);

    let sent = 0;
    let failed = 0;

    for (const [userId, byInterval] of grouped) {
      const email = emails.get(userId);
      if (!email) continue;

      for (const [interval, items] of byInterval) {
        const claimed: typeof items = [];
        let notificationId: string | null = null;

        for (const item of items) {
          const id = await claimNotification({
            userId,
            dedupeKey: item.dedupeKey,
            notificationType: 'deadline_reminder',
            title: `Closing soon: ${item.title}`,
            message: `Closes ${item.closingDate.slice(0, 10)}.`,
            opportunityId: item.opportunityId,
            actionUrl: `/opportunities/${item.slug}`,
          });
          if (id) {
            claimed.push(item);
            notificationId ??= id;
          }
        }

        if (claimed.length === 0 || !notificationId) continue;

        const unsubscribeToken = mintUnsubscribeToken(userId, 'alerts');
        const rendered = deadlineReminderEmail({
          firstName: null,
          daysRemaining: interval,
          opportunities: claimed,
          unsubscribeToken,
        });

        const result = await sendEmail({
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tag: 'deadline-reminder',
          unsubscribeToken,
        });
        await recordDelivery(notificationId, result);
        if (result.ok) sent += 1;
        else failed += 1;
      }
    }

    return { processed: sent, failed, detail: { members: grouped.size } };
  },
};

export const savedSearchMatchingJob: JobDefinition = {
  name: 'saved-search-matching',
  description:
    'Matches newly published records against Premium members’ saved searches.',
  handler: async ({ now, note }) => {
    const supabase = createAdminClient();

    const { data: searches, error } = await supabase
      .from('saved_searches')
      .select(
        'id, user_id, name, filter_configuration, minimum_score, last_run_at',
      )
      .eq('alert_enabled', true)
      .eq('alert_frequency', 'immediate')
      .limit(2000);

    if (error) throw new Error(error.message);
    note('searchCount', searches?.length ?? 0);

    const recipients = new Map(
      (await loadRecipients(now)).map((recipient) => [
        recipient.userId,
        recipient,
      ]),
    );

    let matched = 0;

    for (const search of searches ?? []) {
      const recipient = recipients.get(search.user_id);
      // A member who has lapsed keeps the saved search; its alerts stop.
      if (!recipient || !recipient.immediateAlertsEntitled) continue;

      const since = search.last_run_at
        ? new Date(search.last_run_at)
        : new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const { data: candidates } = await supabase
        .from('opportunities')
        .select(
          'id, slug, title, summary, score, category, status, county_id, city_id, ' +
            'state_id, industry_id, capital_required_min, estimated_value_max, ' +
            'minimum_access_rank, closing_date, is_expired, verification_status, ' +
            'published_at, is_restricted, workflow_status, recommended_next_action, ' +
            'counties ( name )',
        )
        .eq('workflow_status', 'published')
        .eq('is_restricted', false)
        .eq('is_expired', false)
        .gte('score', search.minimum_score)
        .gte('published_at', since.toISOString())
        .limit(200);

      const filters = parseStoredFilters(search.filter_configuration);
      const searchRecipient: AlertRecipient = { ...recipient, filters };

      for (const row of (candidates ?? []) as unknown as CandidateRow[]) {
        const decision = shouldSendHighScoreAlert(
          toCandidate(row, 1),
          searchRecipient,
        );
        if (!decision.send) continue;

        const claimedId = await claimNotification({
          userId: search.user_id,
          dedupeKey: `saved_search:${search.id}:${row.id}`,
          notificationType: 'saved_search_match',
          title: `${search.name}: ${row.title}`,
          message: row.summary.slice(0, 400),
          opportunityId: row.id,
          actionUrl: `/opportunities/${row.slug}`,
        });
        if (claimedId) matched += 1;
      }

      await supabase
        .from('saved_searches')
        .update({
          last_run_at: now.toISOString(),
          ...(matched > 0 ? { last_match_at: now.toISOString() } : {}),
        })
        .eq('id', search.id);
    }

    return {
      processed: matched,
      failed: 0,
      detail: { searches: searches?.length ?? 0 },
    };
  },
};
