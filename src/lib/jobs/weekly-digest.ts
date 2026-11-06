import { createAdminClient } from '@/lib/db/admin';
import type { JobDefinition } from '@/lib/jobs/runner';

export function digestPeriodKey(now: Date): string {
  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 3) % 7) - 1);
  return date.toISOString().slice(0, 10);
}

export const generateWeeklyDigestJob: JobDefinition = {
  name: 'generate-weekly-digest',
  description:
    'Publishes an attributed weekly digest of existing verified records and approved market observations.',
  // Daily attempts retry a failed Thursday run without sending another digest.
  idempotencyKey: digestPeriodKey,
  handler: async () => {
    const { data, error } = await createAdminClient().rpc(
      'publish_automated_weekly_digest',
      { p_preview: false },
    );
    if (error)
      throw new Error(`Weekly digest could not be published: ${error.message}`);
    if (!data || data.reason === 'no_current_verified_content') {
      throw new Error(
        'Weekly digest has no current verified source content. Editorial attention is required.',
      );
    }
    if (!data.created && data.reason !== 'existing_weekly_report')
      throw new Error('Unexpected weekly digest result.');
    return {
      processed: data.created ? 1 : 0,
      failed: 0,
      skipped: !data.created,
      detail: {
        reportId: data.id,
        slug: data.slug,
        reason: data.reason ?? 'published',
        opportunities: data.opportunities ?? null,
      },
    };
  },
};
