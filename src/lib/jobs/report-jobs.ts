import { createAdminClient } from '@/lib/db/admin';
import { enqueueEmail } from '@/lib/email/outbox';
import { loadRecipientPage } from '@/lib/email/recipients';
import { weeklyReportEmail } from '@/lib/email/templates';
import { mintUnsubscribeToken } from '@/lib/email/unsubscribe';
import type { JobDefinition } from '@/lib/jobs/runner';

interface DistributionProgress extends Record<string, unknown> {
  reportId?: string;
  audienceBefore?: string;
  recipientAfter?: string;
}
export const distributeWeeklyReportJob: JobDefinition = {
  name: 'distribute-weekly-report',
  description:
    'Queues published weekly reports with resumable recipient progress.',
  handler: async (context) => {
    if (!context.checkpoint)
      throw new Error('Report distribution requires durable checkpoints.');
    const checkpoint = context.checkpoint,
      client = createAdminClient();
    let progress: DistributionProgress = { ...context.state };
    let query = client
      .from('reports')
      .select(
        `id,title,slug,reporting_period_start,reporting_period_end,
    executive_summary,minimum_access_rank,published_at,email_queued_at,
    report_opportunities(display_order,minimum_access_rank,
      opportunities(id,slug,title,score,minimum_access_rank,workflow_status,is_restricted,published_at,counties(name)))`,
      )
      .eq('report_type', 'weekly')
      .eq('status', 'published')
      .lte('published_at', context.now.toISOString())
      .is('email_queued_at', null)
      .is('distributed_at', null)
      .order('published_at', { ascending: true })
      .order('id')
      .limit(1);
    if (progress.reportId) query = query.eq('id', progress.reportId);
    const { data: report, error } = await query.maybeSingle();
    if (error) throw new Error(error.message);
    if (!report) {
      if (progress.reportId) await checkpoint({});
      return {
        processed: 0,
        failed: 0,
        skipped: true,
        detail: { reason: 'no_unqueued_report' },
      };
    }
    if (!progress.reportId) {
      progress = {
        reportId: report.id,
        audienceBefore: context.now.toISOString(),
      };
      await checkpoint(progress);
    }
    const { data: counties, error: countyError } = await client
      .from('counties')
      .select('id,name');
    if (countyError) throw new Error(countyError.message);
    const countyNames = new Map(
      (counties ?? []).map((county) => [county.id, county.name]),
    );
    // The editor caps a report at 60 entries. Never include a restricted or
    // unpublished source, or trust an entry rank that is lower than its source.
    const entries = (report.report_opportunities ?? [])
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .flatMap((entry) => {
        const source = Array.isArray(entry.opportunities)
          ? entry.opportunities[0]
          : entry.opportunities;
        if (
          !source ||
          source.is_restricted ||
          source.workflow_status !== 'published' ||
          new Date(source.published_at).getTime() > context.now.getTime()
        )
          return [];
        return [
          {
            id: source.id,
            minimumAccessRank: Math.max(
              entry.minimum_access_rank,
              source.minimum_access_rank,
            ),
            title: source.title,
            slug: source.slug,
            score: source.score,
            county: (source.counties as { name?: string } | null)?.name ?? null,
          },
        ];
      });
    const deadline = context.deadlineAt ?? Date.now() + 25_000;
    let queued = 0;
    while (Date.now() < deadline - 5000) {
      const page = await loadRecipientPage(context.now, {
        after: progress.recipientAfter,
        before: progress.audienceBefore,
      });
      for (const member of page.recipients) {
        if (Date.now() >= deadline - 5000)
          return {
            processed: queued,
            failed: 0,
            detail: { more: true, report: report.slug },
          };
        if (
          member.emailAlertsEnabled &&
          !member.disabledAlertTypes.has('weekly_report')
        ) {
          const fullReport =
            member.features.weeklyReports &&
            member.accessRank >= report.minimum_access_rank;
          const visible = entries.filter(
            (entry) => member.accessRank >= entry.minimumAccessRank,
          );
          const highlights = visible.slice(0, fullReport ? 8 : 2);
          const lockedCount = entries.length - visible.length;
          const periodLabel =
            report.reporting_period_start && report.reporting_period_end
              ? `${report.reporting_period_start} to ${report.reporting_period_end}`
              : report.published_at.slice(0, 10);
          const unsubscribeToken = mintUnsubscribeToken(
            member.userId,
            'alerts',
          );
          const rendered = weeklyReportEmail({
            firstName: member.firstName,
            unsubscribeToken,
            reportTitle: report.title,
            reportSlug: report.slug,
            periodLabel,
            headline:
              fullReport && typeof report.executive_summary === 'string'
                ? report.executive_summary.slice(0, 400)
                : 'A new weekly report is available. Sign in to see what your plan includes.',
            counties: member.preferredCountyIds
              .map((id) => countyNames.get(id))
              .filter((name): name is string => typeof name === 'string'),
            highlights,
            lockedCount,
          });
          await enqueueEmail({
            userId: member.userId,
            notifications: [
              {
                dedupe_key: `weekly_report:${report.id}`,
                notification_type: 'report_published',
                title: report.title,
                message: periodLabel,
                action_url: `/reports/${report.slug}`,
              },
            ],
            message: {
              to: member.email,
              ...rendered,
              tag: 'weekly-report',
              unsubscribeToken,
            },
            minimumAccessRank: Math.max(
              fullReport ? Math.max(10, report.minimum_access_rank) : 0,
              ...highlights.map((entry) => entry.minimumAccessRank),
            ),
            alertType: 'weekly_report',
            opportunityIds: highlights.map((entry) => entry.id),
            reportId: report.id,
          });
          queued++;
        }
        progress = { ...progress, recipientAfter: member.userId };
        await checkpoint(progress);
      }
      if (!page.hasMore) {
        const { error: finishError } = await client
          .from('reports')
          .update({ email_queued_at: new Date().toISOString() })
          .eq('id', report.id)
          .is('email_queued_at', null);
        if (finishError) throw new Error(finishError.message);
        // distributed_at belongs to the delivery worker, after every outbox
        // record is sent or deliberately suppressed, never merely after enqueue.
        await checkpoint({});
        return {
          processed: queued,
          failed: 0,
          detail: { queuedAllRecipients: true, report: report.slug },
        };
      }
      progress = { ...progress, recipientAfter: page.nextAfter! };
      await checkpoint(progress);
    }
    return {
      processed: queued,
      failed: 0,
      detail: { more: true, report: report.slug },
    };
  },
};
