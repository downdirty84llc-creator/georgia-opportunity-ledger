import type { NextResponse } from 'next/server';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  checkRateLimit,
  rateLimitIdentity,
} from '@/lib/http/rate-limit';
import { apiError, ok, rateLimited } from '@/lib/http/responses';
import {
  checkWorkflowAction,
  missingPublishFields,
  type WorkflowAction,
  type WorkflowStatus,
} from '@/lib/opportunities/workflow';
import { evaluateLifecycle, type OpportunityStatus } from '@/lib/opportunities/lifecycle';

/**
 * Shared implementation for the workflow endpoints
 * (submit-review, approve, publish, expire, reverify).
 *
 * Each route file is a thin wrapper so the URL surface matches spec 10.2
 * exactly, while the authorisation, transition validation and audit trail live
 * in one place.
 */
export async function performWorkflowAction(
  request: Request,
  opportunityId: string,
  action: WorkflowAction,
): Promise<NextResponse> {
  const viewer = await getViewer();
  if (!viewer.isAuthenticated || viewer.accountStatus !== 'active') {
    return apiError('forbidden', 'Administrator access required.');
  }

  if (action === 'publish') {
    const limit = await checkRateLimit(
      'adminPublish',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);
  }

  const supabase = await createServerSupabaseClient();
  const { data: record, error: loadError } = await supabase
    .from('opportunities')
    .select('*')
    .eq('id', opportunityId)
    .maybeSingle();

  if (loadError) throw new Error(loadError.message);
  if (!record) return apiError('not_found', 'Record not found.');

  const check = checkWorkflowAction(
    viewer.role,
    record.workflow_status as WorkflowStatus,
    action,
  );
  if (!check.allowed) {
    return apiError('conflict', check.reason ?? 'That action is not available.');
  }

  const now = new Date();
  const update: Record<string, unknown> = {};

  if (action === 'reverify') {
    // Records a fresh verification event without moving the record through the
    // workflow: the content is unchanged, its currency is not.
    update.date_verified = now.toISOString().slice(0, 10);
    update.last_reviewed_at = now.toISOString();
    update.verification_status = 'verified';
  } else {
    if (action === 'publish') {
      const missing = missingPublishFields(record as Record<string, unknown>);
      if (missing.length > 0) {
        return apiError(
          'conflict',
          'This record is missing fields that must be filled before publication.',
          { missingFields: missing },
        );
      }
      update.published_at = record.published_at ?? now.toISOString();
      update.published_by = viewer.userId;

      // Re-derive the deadline flags at the moment of publication so a record
      // drafted three weeks ago does not go live labelled "closing soon" when
      // it has already closed.
      const lifecycle = evaluateLifecycle(
        {
          closingDate: record.closing_date ? new Date(record.closing_date) : null,
          openingDate: record.opening_date ? new Date(record.opening_date) : null,
          status: record.status as OpportunityStatus,
        },
        now,
      );
      update.status = lifecycle.status;
      update.is_expired = lifecycle.isExpired;
      update.is_closing_soon = lifecycle.isClosingSoon;
    }

    if (action === 'expire') {
      update.status = 'expired';
      update.is_expired = true;
      update.is_closing_soon = false;
    }

    if (action === 'unpublish') {
      update.published_at = null;
    }

    if (check.targetStatus) update.workflow_status = check.targetStatus;
  }

  const { data: updated, error } = await supabase
    .from('opportunities')
    .update(update)
    .eq('id', opportunityId)
    .select('id, slug, workflow_status, status, published_at, date_verified')
    .single();

  if (error) throw new Error(error.message);

  // Publishing, score changes and access changes are audited by database
  // triggers (migration 0017); the remaining workflow steps are recorded here
  // so the review queue has a complete history.
  if (action !== 'publish') {
    await supabase.rpc('log_admin_action', {
      p_action: `opportunity.${action}`,
      p_entity_type: 'opportunity',
      p_entity_id: opportunityId,
      p_previous: { workflow_status: record.workflow_status },
      p_new: { workflow_status: updated.workflow_status },
    });
  }

  return ok(updated);
}
