import type { NextResponse } from 'next/server';

import { listStaffFactors } from '@/lib/auth/mfa-admin';
import { getViewer } from '@/lib/auth/session';
import { apiError, ok, withErrorHandling } from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/admin/staff
 *
 * Staff accounts and their two-factor enrolment state.
 *
 * Restricted to super administrators rather than all staff: knowing which
 * colleagues have no second factor is a target list, and the only people who
 * can act on it are the ones who can perform a reset.
 */
export const GET = withErrorHandling(async (): Promise<NextResponse> => {
  const viewer = await getViewer();
  if (
    viewer.role !== 'super_administrator' ||
    viewer.accountStatus !== 'active'
  ) {
    return apiError('forbidden', 'Super administrator access required.');
  }

  const staff = await listStaffFactors();
  return ok(staff, { count: staff.length });
});
