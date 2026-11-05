import { z } from 'zod';
import { withAdminHandling } from '@/lib/http/admin-handler';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { apiError, ok, rateLimited } from '@/lib/http/responses';
import { checkRateLimit, rateLimitIdentity } from '@/lib/http/rate-limit';
import { readJsonBody } from '@/lib/http/request-body';
import { sendEmail } from '@/lib/email/client';
import { weeklyReportEmail } from '@/lib/email/templates';
import { mintUnsubscribeToken } from '@/lib/email/unsubscribe';

export const dynamic = 'force-dynamic';

function dedicatedUnsubscribeSecret(): boolean {
  const secret = process.env.EMAIL_UNSUBSCRIBE_SECRET ?? '';
  return secret.length >= 32 && secret !== process.env.CRON_SECRET;
}

export const GET = withAdminHandling(async () => {
  const viewer = await getViewer();
  if (viewer.role !== 'super_administrator')
    return apiError('forbidden', 'Super administrator access required.');
  return ok({ dedicatedUnsubscribeSecret: dedicatedUnsubscribeSecret() });
});

/** Send a diagnostic only to the authenticated administrator's confirmed inbox. */
export const POST = withAdminHandling(async (request) => {
  const viewer = await getViewer();
  if (viewer.role !== 'super_administrator')
    return apiError('forbidden', 'Super administrator access required.');
  const body = z
    .object({ reportId: z.string().uuid() })
    .strict()
    .parse(await readJsonBody(request));
  if (!dedicatedUnsubscribeSecret())
    return apiError(
      'conflict',
      'Configure an independent email unsubscribe secret before this test.',
    );
  const limit = await checkRateLimit(
    'emailTest',
    rateLimitIdentity(request, viewer.userId),
  );
  if (!limit.allowed) return rateLimited(limit.resetAt);
  const client = await createServerSupabaseClient();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();
  if (
    userError ||
    !user?.email ||
    !user.email_confirmed_at ||
    user.id !== viewer.userId
  )
    return apiError(
      'forbidden',
      'A confirmed administrator inbox is required.',
    );
  const { data: report, error } = await client
    .from('reports')
    .select('id,slug,status,reporting_period_start,reporting_period_end')
    .eq('id', body.reportId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!report || report.status !== 'published')
    return apiError('not_found', 'Choose a published report.');
  const token = mintUnsubscribeToken(user.id, 'alerts');
  const rendered = weeklyReportEmail({
    firstName: null,
    reportTitle: 'Ledger weekly report delivery test',
    reportSlug: report.slug,
    periodLabel: `${report.reporting_period_start} to ${report.reporting_period_end}`,
    headline:
      'This is an administrator-requested delivery and unsubscribe test for the Georgia Opportunity Ledger weekly briefing. Follow the report link to see what your plan includes. Your current membership remains unchanged.',
    counties: [],
    highlights: [],
    lockedCount: 0,
    unsubscribeToken: token,
  });
  const result = await sendEmail({
    to: user.email,
    ...rendered,
    unsubscribeToken: token,
    tag: 'administrator-delivery-test',
    idempotencyKey: `ledger-report-test-${report.id}-${user.id}`,
  });
  if (!result.ok)
    return apiError(
      'internal_error',
      'The provider did not confirm delivery submission. Check the inbox and provider logs before retrying.',
      undefined,
      { status: 502 },
    );
  const audit = await client.rpc('log_admin_action', {
    p_action: 'email.delivery_test_sent',
    p_entity_type: 'report',
    p_entity_id: report.id,
    p_previous: null,
    p_new: {
      recipient_user_id: user.id,
      provider_message_id: result.providerMessageId,
    },
  });
  if (audit.error)
    throw new Error(
      'Email submitted, but the audit could not be recorded. Check the inbox before retrying.',
    );
  return ok({
    submitted: true,
    recipient: user.email,
    providerMessageId: result.providerMessageId,
    dedicatedUnsubscribeSecret: true,
  });
});
