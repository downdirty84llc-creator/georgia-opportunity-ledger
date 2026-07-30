import type { UserRole } from '@/lib/billing/subscription';

/**
 * Editorial workflow (spec 5, 15.3).
 *
 * Separation of duties is the point: a researcher can draft and submit but not
 * approve their own work, a reviewer can approve but not publish, and only an
 * editor puts a record in front of members. Encoding it as a table rather than
 * as scattered `if (role === ...)` checks means the rules can be read — and
 * tested — in one place.
 */

export type WorkflowStatus =
  | 'draft'
  | 'source_collected'
  | 'verification_pending'
  | 'analysis_pending'
  | 'internal_review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'updated'
  | 'expired'
  | 'archived';

export type WorkflowAction =
  | 'edit'
  | 'submit_review'
  | 'approve'
  | 'return_for_revision'
  | 'schedule'
  | 'publish'
  | 'unpublish'
  | 'expire'
  | 'reverify'
  | 'archive'
  | 'restore';

const ALLOWED_TRANSITIONS: Readonly<Record<WorkflowStatus, readonly WorkflowStatus[]>> = {
  draft: ['source_collected', 'verification_pending', 'internal_review', 'archived'],
  source_collected: ['verification_pending', 'internal_review', 'archived'],
  verification_pending: ['analysis_pending', 'internal_review', 'archived'],
  analysis_pending: ['internal_review', 'archived'],
  internal_review: ['approved', 'analysis_pending', 'draft', 'archived'],
  approved: ['scheduled', 'published', 'internal_review', 'archived'],
  scheduled: ['published', 'approved', 'archived'],
  published: ['updated', 'expired', 'internal_review', 'archived'],
  updated: ['published', 'expired', 'internal_review', 'archived'],
  expired: ['published', 'archived'],
  archived: ['draft'],
};

const ACTION_ROLES: Readonly<Record<WorkflowAction, readonly UserRole[]>> = {
  edit: ['researcher', 'reviewer', 'editor', 'super_administrator'],
  submit_review: ['researcher', 'reviewer', 'editor', 'super_administrator'],
  approve: ['reviewer', 'editor', 'super_administrator'],
  return_for_revision: ['reviewer', 'editor', 'super_administrator'],
  schedule: ['reviewer', 'editor', 'super_administrator'],
  publish: ['editor', 'super_administrator'],
  unpublish: ['editor', 'super_administrator'],
  expire: ['reviewer', 'editor', 'super_administrator'],
  reverify: ['researcher', 'reviewer', 'editor', 'super_administrator'],
  archive: ['editor', 'super_administrator'],
  restore: ['super_administrator'],
};

const ACTION_TARGET: Readonly<Record<WorkflowAction, WorkflowStatus | null>> = {
  edit: null,
  submit_review: 'internal_review',
  approve: 'approved',
  return_for_revision: 'analysis_pending',
  schedule: 'scheduled',
  publish: 'published',
  unpublish: 'internal_review',
  expire: 'expired',
  reverify: null,
  archive: 'archived',
  restore: 'draft',
};

export function canTransition(
  from: WorkflowStatus,
  to: WorkflowStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function roleMayPerform(role: UserRole, action: WorkflowAction): boolean {
  return ACTION_ROLES[action].includes(role);
}

export function targetStatusFor(action: WorkflowAction): WorkflowStatus | null {
  return ACTION_TARGET[action];
}

export interface WorkflowCheck {
  allowed: boolean;
  reason?: string;
  targetStatus?: WorkflowStatus;
}

export function checkWorkflowAction(
  role: UserRole,
  currentStatus: WorkflowStatus,
  action: WorkflowAction,
): WorkflowCheck {
  if (!roleMayPerform(role, action)) {
    return {
      allowed: false,
      reason: `Your role cannot ${action.replace(/_/g, ' ')} a record.`,
    };
  }

  const target = targetStatusFor(action);
  if (target === null) return { allowed: true };

  if (currentStatus === target) {
    return {
      allowed: false,
      reason: `This record is already ${target.replace(/_/g, ' ')}.`,
    };
  }

  if (!canTransition(currentStatus, target)) {
    return {
      allowed: false,
      reason:
        `A record cannot move from ${currentStatus.replace(/_/g, ' ')} to ` +
        `${target.replace(/_/g, ' ')}.`,
    };
  }

  return { allowed: true, targetStatus: target };
}

/**
 * Fields that must be filled before a record may be published. Catching this
 * at the API rather than only in the form means a record published through a
 * script cannot skip the analysis a subscriber is paying for.
 */
export const PUBLISH_REQUIRED_FIELDS = [
  'title',
  'summary',
  'category',
  'subtype',
  'source_id',
  'original_source_url',
  'risk_summary',
  'recommended_next_action',
  'score_explanation',
  'date_verified',
] as const;

export function missingPublishFields(
  record: Record<string, unknown>,
): string[] {
  return PUBLISH_REQUIRED_FIELDS.filter((field) => {
    const value = record[field];
    return (
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim().length === 0)
    );
  });
}
