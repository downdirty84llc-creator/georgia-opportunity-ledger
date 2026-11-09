import { z } from 'zod';
import { canReviewRequests, REQUEST_CONFIG } from '@/lib/admin/member-requests';
import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { withAdminHandling } from '@/lib/http/admin-handler';
import { readJsonBody } from '@/lib/http/request-body';
import { apiError, ok } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';
export const POST = withAdminHandling(async (request) => {
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return apiError('forbidden', 'Submit reviews from the Ledger admin page.');
  const body = z
    .object({
      kind: z.enum(['corrections', 'support']),
      id: z.string().uuid(),
      expectedUpdatedAt: z.string().datetime({ offset: true }),
      status: z.string(),
      note: z.string().trim().min(10).max(8000),
    })
    .strict()
    .parse(await readJsonBody(request));
  const viewer = await getViewer();
  if (!canReviewRequests(body.kind, viewer.role))
    return apiError(
      'forbidden',
      'Your staff role cannot review these requests.',
    );
  if (
    !(REQUEST_CONFIG[body.kind].statuses as readonly string[]).includes(
      body.status,
    )
  )
    return apiError('bad_request', 'Select a valid request status.');
  const db = await createServerSupabaseClient();
  const { error } = await db.rpc('review_member_request', {
    p_kind: body.kind,
    p_id: body.id,
    p_expected_updated_at: body.expectedUpdatedAt,
    p_status: body.status,
    p_note: body.note,
  });
  if (error?.code === '42501')
    return apiError('forbidden', 'Verified staff access required.');
  if (error?.code === 'P0002')
    return apiError('not_found', 'Request not found.');
  if (error?.code === '40001')
    return apiError(
      'conflict',
      'This request changed. Reload the page before saving your review.',
    );
  if (error?.code === '22023')
    return apiError(
      'bad_request',
      'Check the note and status. A correction must be accepted before it can be marked published.',
    );
  if (error) throw new Error(error.message);
  return ok({ reviewed: true });
});
