import { z } from 'zod';
import { getViewer } from '@/lib/auth/session';
import { createAdminClient } from '@/lib/db/admin';
import { withAdminHandling } from '@/lib/http/admin-handler';
import { readJsonBody } from '@/lib/http/request-body';
import { apiError, ok } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

export const POST = withAdminHandling(async (request) => {
  const viewer = await getViewer();
  if (!['billing_manager', 'super_administrator'].includes(viewer.role)) {
    return apiError('forbidden', 'Billing administrator access required.');
  }
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return apiError('forbidden', 'Submit reviews from the Ledger admin page.');
  }
  const body = z
    .object({
      eventId: z.string().uuid(),
      outcome: z.enum(['no_change', 'handled_in_stripe']),
      note: z.string().trim().min(10).max(2000),
    })
    .strict()
    .parse(await readJsonBody(request));
  const { data, error } = await createAdminClient().rpc(
    'review_billing_event',
    {
      p_event_id: body.eventId,
      p_actor_id: viewer.userId,
      p_outcome: body.outcome,
      p_note: body.note,
    },
  );
  if (error?.code === '42501')
    return apiError(
      'forbidden',
      'Active billing administrator access required.',
    );
  if (error) throw new Error(error.message);
  if (data === 'not_found')
    return apiError('not_found', 'Review item not found.');
  if (data === 'processing')
    return apiError(
      'conflict',
      'Webhook processing must finish before review.',
    );
  if (data === 'already_reviewed')
    return apiError(
      'conflict',
      'Another review is already recorded. Refresh the page.',
    );
  if (data !== 'reviewed') throw new Error('Unexpected billing review result');
  return ok({ reviewed: true });
});
