import { createAdminClient } from '@/lib/db/admin';
import {
  shouldSendHighScoreAlert,
  shouldSendClosingSoonAlert,
} from '@/lib/alerts/matching';
import {
  EMAIL_CANDIDATE_SELECT,
  toCandidate,
  type CandidateRow,
} from '@/lib/email/candidates';
import { enqueueEmail } from '@/lib/email/outbox';
import {
  loadRecipientPage,
  queuedNotificationKeys,
} from '@/lib/email/recipients';
import {
  premiumAlertEmail,
  deadlineReminderEmail,
} from '@/lib/email/templates';
import { mintUnsubscribeToken } from '@/lib/email/unsubscribe';
import { classifyScore } from '@/lib/scoring/score';
import { dailyKey, type JobDefinition } from '@/lib/jobs/runner';
import { dueReminderInterval } from '@/lib/opportunities/lifecycle';

interface AlertProgress extends Record<string, unknown> {
  since?: string;
  windowEnd?: string;
  afterOpportunity?: string;
  opportunityId?: string;
  recipientAfter?: string;
}
export const durablePremiumAlertsJob: JobDefinition = {
  name: 'premium-alerts',
  description:
    'Queues new opportunity emails using resumable opportunity and recipient cursors.',
  handler: async (context) => {
    if (!context.checkpoint)
      throw new Error('Email jobs require durable runner checkpoints.');
    const checkpoint = context.checkpoint,
      client = createAdminClient();
    const deadline = context.deadlineAt ?? Date.now() + 25_000;
    let progress: AlertProgress = { ...context.state };
    if (!progress.windowEnd) {
      progress = {
        since:
          progress.since ??
          new Date(context.now.getTime() - 86400000).toISOString(),
        windowEnd: context.now.toISOString(),
      };
      await checkpoint(progress);
    }
    let queued = 0;
    while (Date.now() < deadline - 5000) {
      let query = client
        .from('opportunities')
        .select(EMAIL_CANDIDATE_SELECT)
        .eq('workflow_status', 'published')
        .eq('is_restricted', false)
        .eq('is_expired', false)
        .gte('updated_at', progress.since!)
        .lt('updated_at', progress.windowEnd!)
        .lte('published_at', progress.windowEnd!)
        .order('id')
        .limit(1);
      if (progress.opportunityId)
        query = query.eq('id', progress.opportunityId);
      else if (progress.afterOpportunity)
        query = query.gt('id', progress.afterOpportunity);
      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) {
        if (progress.opportunityId) {
          progress = {
            ...progress,
            afterOpportunity: progress.opportunityId,
            opportunityId: undefined,
            recipientAfter: undefined,
          };
          await checkpoint(progress);
          continue;
        }
        await checkpoint({ since: progress.windowEnd });
        return {
          processed: queued,
          failed: 0,
          detail: { windowComplete: true },
        };
      }
      const row = data as unknown as CandidateRow;
      progress = { ...progress, opportunityId: row.id };
      const page = await loadRecipientPage(context.now, {
        after: progress.recipientAfter,
        before: progress.windowEnd,
      });
      for (const recipient of page.recipients) {
        if (Date.now() >= deadline - 5000)
          return { processed: queued, failed: 0, detail: { more: true } };
        const decision = shouldSendHighScoreAlert(
          toCandidate(row, 1),
          recipient,
          context.now,
        );
        if (decision.send && decision.dedupeKey) {
          const unsubscribeToken = mintUnsubscribeToken(
            recipient.userId,
            'alerts',
          );
          const rendered = premiumAlertEmail({
            firstName: recipient.firstName,
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
          await enqueueEmail({
            userId: recipient.userId,
            notifications: [
              {
                dedupe_key: decision.dedupeKey,
                notification_type: 'opportunity_alert',
                title: row.title,
                message: row.summary.slice(0, 400),
                opportunity_id: row.id,
                action_url: `/opportunities/${row.slug}`,
              },
            ],
            message: {
              to: recipient.email,
              ...rendered,
              tag: 'premium-alert',
              unsubscribeToken,
            },
            minimumAccessRank: Math.max(30, row.minimum_access_rank),
            alertType: 'high_score',
            opportunityIds: [row.id],
          });
          queued++;
        }
        progress = { ...progress, recipientAfter: recipient.userId };
        await checkpoint(progress);
      }
      if (page.hasMore) {
        progress = { ...progress, recipientAfter: page.nextAfter! };
      } else {
        progress = {
          ...progress,
          afterOpportunity: row.id,
          opportunityId: undefined,
          recipientAfter: undefined,
        };
      }
      await checkpoint(progress);
    }
    return { processed: queued, failed: 0, detail: { more: true } };
  },
};

interface ReminderProgress extends Record<string, unknown> {
  day?: string;
  windowEnd?: string;
  completedDay?: string;
  userAfter?: string;
  userId?: string;
  savedAfter?: string;
}
export const durableDeadlineRemindersJob: JobDefinition = {
  name: 'deadline-reminders',
  description:
    'Queues saved-record deadline reminders in resumable recipient batches.',
  handler: async (context) => {
    if (!context.checkpoint)
      throw new Error('Email jobs require durable runner checkpoints.');
    const checkpoint = context.checkpoint,
      client = createAdminClient(),
      day = dailyKey(context.now);
    let progress: ReminderProgress = { ...context.state };
    if (!progress.day) {
      if (progress.completedDay === day || context.now.getUTCHours() < 13)
        return {
          processed: 0,
          failed: 0,
          skipped: true,
          detail: { reason: 'daily_reminders_not_due' },
        };
      progress = { day, windowEnd: context.now.toISOString() };
      await checkpoint(progress);
    }
    const campaignNow = new Date(progress.windowEnd!);
    const deadline = context.deadlineAt ?? Date.now() + 25_000;
    let queued = 0;
    while (Date.now() < deadline - 5000) {
      const page = await loadRecipientPage(
        context.now,
        progress.userId
          ? { ids: [progress.userId] }
          : { after: progress.userAfter, before: progress.windowEnd },
      );
      const recipient = page.recipients[0];
      if (!recipient) {
        if (progress.userId || page.hasMore) {
          progress = {
            ...progress,
            userAfter: progress.userId ?? page.nextAfter!,
            userId: undefined,
            savedAfter: undefined,
          };
          await checkpoint(progress);
          continue;
        }
        await checkpoint({ completedDay: progress.day });
        return { processed: queued, failed: 0, detail: { dayComplete: true } };
      }
      progress = { ...progress, userId: recipient.userId };
      let query = client
        .from('saved_opportunities')
        .select(`opportunity_id,opportunities!inner(${EMAIL_CANDIDATE_SELECT})`)
        .eq('user_id', recipient.userId)
        .order('opportunity_id')
        .limit(50);
      if (progress.savedAfter)
        query = query.gt('opportunity_id', progress.savedAfter);
      const { data: saved, error } = await query;
      if (error) throw new Error(error.message);
      const items = (saved ?? []).flatMap((entry) => {
        const row = (Array.isArray(entry.opportunities)
          ? entry.opportunities[0]
          : entry.opportunities) as unknown as CandidateRow;
        const decision = shouldSendClosingSoonAlert(
          toCandidate(row, 1),
          recipient,
          campaignNow,
        );
        if (!decision.send || !decision.dedupeKey || !row.closing_date)
          return [];
        const interval = dueReminderInterval(
          new Date(row.closing_date),
          campaignNow,
        );
        return interval === null
          ? []
          : [{ row, key: decision.dedupeKey, interval }];
      });
      const existing = await queuedNotificationKeys(
        recipient.userId,
        items.map((item) => item.key),
      );
      for (const interval of new Set(items.map((item) => item.interval))) {
        const group = items.filter(
          (item) => item.interval === interval && !existing.has(item.key),
        );
        if (!group.length) continue;
        const unsubscribeToken = mintUnsubscribeToken(
          recipient.userId,
          'alerts',
        );
        const rendered = deadlineReminderEmail({
          firstName: recipient.firstName,
          daysRemaining: interval,
          unsubscribeToken,
          opportunities: group.map(({ row }) => ({
            title: row.title,
            slug: row.slug,
            closingDate: row.closing_date!,
            score: row.score,
          })),
        });
        await enqueueEmail({
          userId: recipient.userId,
          notifications: group.map(({ row, key }) => ({
            dedupe_key: key,
            notification_type: 'deadline_reminder',
            title: `Closing soon: ${row.title}`,
            message: `Closes ${row.closing_date!.slice(0, 10)}.`,
            opportunity_id: row.id,
            action_url: `/opportunities/${row.slug}`,
          })),
          message: {
            to: recipient.email,
            ...rendered,
            tag: 'deadline-reminder',
            unsubscribeToken,
          },
          minimumAccessRank: Math.max(
            ...group.map((item) => item.row.minimum_access_rank),
          ),
          alertType: 'closing_soon',
          opportunityIds: group.map((item) => item.row.id),
        });
        queued++;
      }
      if ((saved?.length ?? 0) === 50)
        progress = {
          ...progress,
          savedAfter: saved![saved!.length - 1]!.opportunity_id,
        };
      else
        progress = {
          ...progress,
          userAfter: recipient.userId,
          userId: undefined,
          savedAfter: undefined,
        };
      await checkpoint(progress);
    }
    return { processed: queued, failed: 0, detail: { more: true } };
  },
};
