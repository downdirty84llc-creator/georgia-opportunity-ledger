import type { NextResponse } from 'next/server';

import { performWorkflowAction } from '@/lib/opportunities/admin-actions';
import { withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/admin/opportunities/{id}/publish
 *
 * Publishes an approved record to members.
 */
export const POST = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    return performWorkflowAction(request, id, 'publish');
  },
);
