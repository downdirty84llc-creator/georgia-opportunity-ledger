import {
  deadlineRemindersJob,
  premiumAlertsJob,
  savedSearchMatchingJob,
} from '@/lib/jobs/alert-jobs';
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
import { distributeWeeklyReportJob } from '@/lib/jobs/report-jobs';
import type { JobDefinition } from '@/lib/jobs/runner';

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
  { definition: evaluateDeadlinesJob, schedule: '10 5 * * *' },
  { definition: deadlineRemindersJob, schedule: '0 13 * * *' },
  { definition: reverificationRemindersJob, schedule: '30 5 * * *' },
  { definition: staleSourceRemindersJob, schedule: '40 5 * * *' },
  { definition: expireLapsedAccessJob, schedule: '20 5 * * *' },
  { definition: syncSubscriptionsJob, schedule: '0 */6 * * *' },
  { definition: aggregateAnalyticsJob, schedule: '15 6 * * *' },
  { definition: pruneJob, schedule: '45 6 * * *' },
  // Thursdays at 12:00 UTC — mid-morning Eastern, when the weekly lands.
  { definition: distributeWeeklyReportJob, schedule: '0 12 * * 4' },
];

export function findJob(name: string): JobDefinition | null {
  return JOBS.find((job) => job.definition.name === name)?.definition ?? null;
}

export function jobNames(): string[] {
  return JOBS.map((job) => job.definition.name);
}
