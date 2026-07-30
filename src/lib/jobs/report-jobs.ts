import { parsePlanFeatures, type PlanCode } from '@/lib/access/ranks';
import {
  effectiveAccessRank,
  type AccountStatus,
  type SubscriptionStatus,
  type UserRole,
} from '@/lib/billing/subscription';
import { createAdminClient } from '@/lib/db/admin';
import { sendEmail } from '@/lib/email/client';
import { weeklyReportEmail } from '@/lib/email/templates';
import { weeklyKey, type JobDefinition } from '@/lib/jobs/runner';

/**
 * Weekly report distribution (spec 16, 17).
 *
 * Personalised three ways: the member's counties are named, the highlight list
 * is filtered to records their plan can actually open, and the count of records
 * above their tier is stated plainly rather than hidden. Telling someone there
 * are four more records they cannot see is a better upgrade argument than
 * quietly omitting them.
 */
export const distributeWeeklyReportJob: JobDefinition = {
  name: 'distribute-weekly-report',
  description: 'Emails the most recent published weekly report to members.',
  idempotencyKey: weeklyKey,
  handler: async ({ now, note }) => {
    const supabase = createAdminClient();

    const { data: report, error } = await supabase
      .from('reports')
      .select(
        `
        id, title, slug, reporting_period_start, reporting_period_end,
        executive_summary, minimum_access_rank, published_at, distributed_at,
        report_opportunities (
          display_order, minimum_access_rank,
          opportunities ( id, slug, title, score, counties ( name ) )
        )
      `,
      )
      .eq('report_type', 'weekly')
      .eq('status', 'published')
      .is('distributed_at', null)
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!report) {
      return {
        processed: 0,
        failed: 0,
        skipped: true,
        detail: { reason: 'no_undistributed_weekly_report' },
      };
    }

    const { data: members, error: memberError } = await supabase
      .from('profiles')
      .select(
        `
        id, role, account_status, first_name,
        access_rank_override, access_rank_override_expires_at,
        user_preferences ( email_alerts_enabled, preferred_county_ids ),
        subscriptions ( status, current_period_end, cancel_at_period_end,
          subscription_plans ( code, access_rank, feature_configuration ) )
      `,
      )
      .eq('account_status', 'active')
      .limit(5000);

    if (memberError) throw new Error(memberError.message);

    const { data: authUsers } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    const emails = new Map(
      (authUsers?.users ?? [])
        .filter((user) => user.email)
        .map((user) => [user.id, user.email as string]),
    );

    const countyNames = new Map<string, string>();
    const { data: counties } = await supabase.from('counties').select('id, name');
    for (const county of counties ?? []) countyNames.set(county.id, county.name);

    const entries = (report.report_opportunities ?? [])
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map((entry) => {
        const opportunity = Array.isArray(entry.opportunities)
          ? entry.opportunities[0]
          : entry.opportunities;
        const county = opportunity?.counties as { name?: string } | null;
        return {
          minimumAccessRank: entry.minimum_access_rank,
          title: opportunity?.title ?? 'Untitled record',
          slug: opportunity?.slug ?? '',
          score: opportunity?.score ?? 0,
          county: county?.name ?? null,
        };
      });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const member of members ?? []) {
      const email = emails.get(member.id);
      if (!email) continue;

      const preferences = Array.isArray(member.user_preferences)
        ? member.user_preferences[0]
        : member.user_preferences;
      if (preferences?.email_alerts_enabled === false) {
        skipped += 1;
        continue;
      }

      const subscription = Array.isArray(member.subscriptions)
        ? member.subscriptions[0]
        : member.subscriptions;
      const plan = subscription
        ? Array.isArray(subscription.subscription_plans)
          ? subscription.subscription_plans[0]
          : subscription.subscription_plans
        : null;

      const accessRank = effectiveAccessRank(
        {
          role: member.role as UserRole,
          accountStatus: member.account_status as AccountStatus,
          accessRankOverride: member.access_rank_override,
          accessRankOverrideExpiresAt: member.access_rank_override_expires_at
            ? new Date(member.access_rank_override_expires_at)
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

      // Free members are on the list, but they get the preview version of the
      // weekly rather than nothing at all (spec 5, "Free Member").
      const visible = entries.filter((entry) => accessRank >= entry.minimumAccessRank);
      const lockedCount = entries.length - visible.length;
      const highlights = features.weeklyReports
        ? visible.slice(0, 8)
        : visible.slice(0, 2);

      if (highlights.length === 0 && lockedCount === 0) {
        skipped += 1;
        continue;
      }

      const preferredCounties = (preferences?.preferred_county_ids ?? [])
        .map((id: string) => countyNames.get(id))
        .filter((name: string | undefined): name is string => Boolean(name));

      const periodLabel =
        report.reporting_period_start && report.reporting_period_end
          ? `${report.reporting_period_start} to ${report.reporting_period_end}`
          : new Date(report.published_at ?? now).toISOString().slice(0, 10);

      const rendered = weeklyReportEmail({
        firstName: member.first_name,
        reportTitle: report.title,
        reportSlug: report.slug,
        periodLabel,
        headline:
          typeof report.executive_summary === 'string'
            ? report.executive_summary.slice(0, 400)
            : `${entries.length} records in this week's ledger.`,
        counties: preferredCounties,
        highlights,
        lockedCount,
      });

      const { data: notification } = await supabase
        .from('notifications')
        .insert({
          user_id: member.id,
          notification_type: 'report_published',
          title: report.title,
          message: periodLabel,
          report_id: report.id,
          action_url: `/reports/${report.slug}`,
          dedupe_key: `weekly_report:${report.id}`,
        })
        .select('id')
        .single();

      // A conflict means this member already received this report.
      if (!notification) {
        skipped += 1;
        continue;
      }

      const result = await sendEmail({
        to: email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tag: 'weekly-report',
      });

      await supabase.from('notification_deliveries').insert({
        notification_id: notification.id,
        delivery_method: 'email',
        provider_message_id: result.providerMessageId,
        delivery_status: result.ok ? 'sent' : 'failed',
        delivered_at: result.ok ? new Date().toISOString() : null,
        error_message: result.error ?? null,
      });

      if (result.ok) sent += 1;
      else failed += 1;
    }

    await supabase
      .from('reports')
      .update({ distributed_at: now.toISOString() })
      .eq('id', report.id);

    note('report', report.slug);

    return {
      processed: sent,
      failed,
      detail: { report: report.slug, skipped, recipients: members?.length ?? 0 },
    };
  },
};
