import { savedSearchMatchingJob } from '@/lib/jobs/alert-jobs';
import {
  durablePremiumAlertsJob as premiumAlertsJob,
  durableDeadlineRemindersJob as deadlineRemindersJob,
} from '@/lib/jobs/email-alert-jobs';
import { deliverQueuedEmailsJob } from '@/lib/email/outbox';
import {
  evaluateDeadlinesJob,
  publishScheduledJob,
  reverificationRemindersJob,
  staleSourceRemindersJob,
} from '@/lib/jobs/lifecycle-jobs';
import {
  aggregateAnalyticsJob,
  expireLapsedAccessJob,
  processExportsJob,
  pruneJob,
  syncSubscriptionsJob,
} from '@/lib/jobs/maintenance-jobs';
import { scanAttachmentsJob } from '@/lib/jobs/file-jobs';
import { distributeWeeklyReportJob } from '@/lib/jobs/report-jobs';
import type { JobDefinition } from '@/lib/jobs/runner';
import { closeAccountBillingJob } from '@/lib/billing/close-account';

/**
 * Every background job, and the cadence each expects (spec 17).
 *
 * The schedule lives here as data so that `vercel.json` and the runbook can be
 * generated from one source rather than drifting apart.
 */
export interface ScheduledJob {
  definition: JobDefinition;
  /** Cron expression, UTC. */
  schedule: string;
}

export const JOBS: readonly ScheduledJob[] = [
  { definition: publishScheduledJob, schedule: '*/15 * * * *' },
  { definition: premiumAlertsJob, schedule: '*/15 * * * *' },
  { definition: savedSearchMatchingJob, schedule: '*/30 * * * *' },
  { definition: processExportsJob, schedule: '*/5 * * * *' },
  { definition: closeAccountBillingJob, schedule: '*/5 * * * *' },
  { definition: evaluateDeadlinesJob, schedule: '10 5 * * *' },
  { definition: deadlineRemindersJob, schedule: '*/5 * * * *' },
  { definition: deliverQueuedEmailsJob, schedule: '*/5 * * * *' },
  { definition: reverificationRemindersJob, schedule: '30 5 * * *' },
  { definition: staleSourceRemindersJob, schedule: '40 5 * * *' },
  { definition: expireLapsedAccessJob, schedule: '20 5 * * *' },
  { definition: syncSubscriptionsJob, schedule: '*/5 * * * *' },
  { definition: aggregateAnalyticsJob, schedule: '15 6 * * *' },
  { definition: pruneJob, schedule: '45 6 * * *' },
  { definition: scanAttachmentsJob, schedule: '*/20 * * * *' },
  // Publishing is editorially scheduled; delivery resumes until every recipient is queued.
  { definition: distributeWeeklyReportJob, schedule: '*/15 * * * *' },
];

export function findJob(name: string): JobDefinition | null {
  return JOBS.find((job) => job.definition.name === name)?.definition ?? null;
}

export function jobNames(): string[] {
  return JOBS.map((job) => job.definition.name);
}
