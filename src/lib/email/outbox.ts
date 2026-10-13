import { createAdminClient } from '@/lib/db/admin';
import type { EmailMessage } from '@/lib/email/client';
import {
  deliveryCredentials,
  prepareEmail,
  sendPreparedEmail,
  type PreparedEmail,
} from '@/lib/email/durable-client';
import type { JobDefinition } from '@/lib/jobs/runner';

export interface EmailNotification {
  dedupe_key: string;
  notification_type: string;
  title: string;
  message: string;
  opportunity_id?: string;
  action_url: string;
}

export async function enqueueEmail(input: {
  userId: string;
  notifications: EmailNotification[];
  message: EmailMessage;
  minimumAccessRank: number;
  alertType: string;
  opportunityIds?: string[];
  reportId?: string;
}): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc(
    'enqueue_notification_email',
    {
      p_user_id: input.userId,
      p_notifications: input.notifications,
      p_email: prepareEmail(input.message),
      p_minimum_rank: input.minimumAccessRank,
      p_alert_type: input.alertType,
      p_opportunity_ids: input.opportunityIds ?? [],
      p_report_id: input.reportId ?? null,
    },
  );
  if (error) throw new Error(`Could not queue email: ${error.message}`);
  return data as string | null;
}

export async function memberEmailAddresses(
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const addresses = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { data, error } = await createAdminClient().rpc(
      'email_addresses_for_members',
      { p_ids: ids.slice(offset, offset + 100) },
    );
    if (error)
      throw new Error(
        `Could not load member email addresses: ${error.message}`,
      );
    for (const row of data as { id: string; email: string }[])
      addresses.set(row.id, row.email);
  }
  return addresses;
}

export const deliverQueuedEmailsJob: JobDefinition = {
  name: 'deliver-queued-emails',
  description:
    'Retries durable email requests and finalizes report distribution.',
  handler: async ({ note }) => {
    const credentials = deliveryCredentials();
    const client = createAdminClient();
    const deadline = Date.now() + 28_000;
    let sent = 0,
      failed = 0;
    while (Date.now() < deadline - 10_000 && sent + failed < 25) {
      const { data: item, error } = await client.rpc('claim_email_delivery', {
        p_provider: credentials.provider,
        p_fingerprint: credentials.fingerprint,
      });
      if (error)
        throw new Error(`Could not claim queued email: ${error.message}`);
      if (!item?.id) break;
      const result = await sendPreparedEmail(
        item.email as PreparedEmail,
        `ledger-email/${item.id}`,
      );
      const { data: finished, error: finishError } = await client.rpc(
        'finish_email_delivery',
        {
          p_id: item.id,
          p_token: item.lease_token,
          p_state: result.ok
            ? 'sent'
            : result.needsReview
              ? 'needs_review'
              : 'queued',
          p_provider_id: result.providerMessageId,
          p_error: result.error ?? null,
        },
      );
      if (finishError || !finished)
        throw new Error(
          `Could not record email outcome: ${finishError?.message ?? 'worker lease lost'}`,
        );
      if (result.ok) sent++;
      else failed++;
    }
    const { data: completed, error: completionError } = await client.rpc(
      'complete_email_distributions',
    );
    if (completionError) throw new Error(completionError.message);
    const { count, error: reviewError } = await client
      .from('email_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('state', 'needs_review');
    if (reviewError) throw new Error(reviewError.message);
    note('needsReview', count ?? 0);
    return {
      processed: sent,
      failed: Math.max(failed, count ?? 0),
      detail: { reportsCompleted: completed, needsReview: count ?? 0 },
    };
  },
};
