/**
 * Alert matching (spec 18).
 *
 * Every rule returns a decision with a reason rather than a boolean, because
 * "why didn't my alert fire?" is the single most common support question a
 * product like this generates, and the answer needs to be in the job log.
 *
 * Suppression is expressed as a dedupe key rather than as a timestamp
 * comparison. Keys are stable and content-addressed: the same event for the
 * same member always produces the same key, so the unique index on
 * `notifications (user_id, dedupe_key)` makes duplicate sends impossible even
 * if a job is retried mid-run.
 */

import type { OpportunityFilters } from '@/lib/search/filters';
import {
  dueReminderInterval,
  reminderDedupeKey,
} from '@/lib/opportunities/lifecycle';

export interface AlertCandidate {
  opportunityId: string;
  versionNumber: number;
  score: number;
  category: string;
  status: string;
  countyId: string | null;
  cityId: string | null;
  stateId: string | null;
  industryIds: readonly string[];
  propertyType: string | null;
  fundingType: string | null;
  capitalRequiredMin: number | null;
  estimatedValueMax: number | null;
  minimumAccessRank: number;
  closingDate: Date | null;
  isExpired: boolean;
  verificationStatus: string;
  publishedAt: Date | null;
  isRestricted: boolean;
  workflowStatus: string;
}

export interface AlertRecipient {
  userId: string;
  accessRank: number;
  accountStatus: 'active' | 'suspended' | 'closed';
  emailAlertsEnabled: boolean;
  immediateAlertsEntitled: boolean;
  minimumScore: number;
  filters: OpportunityFilters;
  /** Alert types the member has switched off. */
  disabledAlertTypes: ReadonlySet<string>;
  /** Dedupe keys already recorded for this member. */
  deliveredKeys: ReadonlySet<string>;
}

export type AlertKind = 'high_score' | 'material_update' | 'closing_soon';

export interface AlertDecision {
  send: boolean;
  reason:
    | 'match'
    | 'account_inactive'
    | 'alerts_disabled'
    | 'alert_type_disabled'
    | 'not_entitled'
    | 'insufficient_access_rank'
    | 'below_minimum_score'
    | 'filters_not_matched'
    | 'not_published'
    | 'expired'
    | 'deadline_unverified'
    | 'no_deadline'
    | 'no_reminder_due'
    | 'already_sent';
  dedupeKey?: string;
}

function decline(reason: AlertDecision['reason']): AlertDecision {
  return { send: false, reason };
}

// ---------------------------------------------------------------------------
// Filter matching
// ---------------------------------------------------------------------------

function inList<T>(list: readonly T[] | undefined, value: T | null): boolean {
  if (!list || list.length === 0) return true;
  if (value === null) return false;
  return list.includes(value);
}

/**
 * Whether a record satisfies a stored filter document.
 *
 * An absent filter means "no constraint". Free-text search is deliberately not
 * evaluated here: matching `q` requires the full-text index, so the job applies
 * it in SQL when it loads candidates and this function handles the structured
 * predicates only.
 */
export function matchesFilters(
  candidate: AlertCandidate,
  filters: OpportunityFilters,
): boolean {
  if (!inList(filters.category, candidate.category)) return false;
  if (!inList(filters.status, candidate.status)) return false;
  if (!inList(filters.countyIds, candidate.countyId)) return false;
  if (!inList(filters.cityIds, candidate.cityId)) return false;
  if (!inList(filters.propertyTypes, candidate.propertyType)) return false;
  if (!inList(filters.fundingTypes, candidate.fundingType)) return false;
  if (!inList(filters.verificationStatus, candidate.verificationStatus)) {
    return false;
  }

  if (filters.industryIds && filters.industryIds.length > 0) {
    const wanted = new Set(filters.industryIds);
    if (!candidate.industryIds.some((id) => wanted.has(id))) return false;
  }

  if (filters.minScore !== undefined && candidate.score < filters.minScore) {
    return false;
  }

  // A record with no stated capital requirement is not excluded by a capital
  // ceiling — unresearched is not the same as unaffordable.
  if (
    filters.capitalMax !== undefined &&
    candidate.capitalRequiredMin !== null
  ) {
    if (candidate.capitalRequiredMin > filters.capitalMax) return false;
  }
  if (
    filters.capitalMin !== undefined &&
    candidate.capitalRequiredMin !== null
  ) {
    if (candidate.capitalRequiredMin < filters.capitalMin) return false;
  }

  if (filters.deadlineFrom && candidate.closingDate) {
    if (candidate.closingDate < filters.deadlineFrom) return false;
  }
  if (filters.deadlineTo) {
    if (!candidate.closingDate) return false;
    if (candidate.closingDate > filters.deadlineTo) return false;
  }

  if (filters.closingSoon && !candidate.isExpired) {
    if (!candidate.closingDate) return false;
  }

  if (!filters.includeExpired && candidate.isExpired) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Dedupe keys
// ---------------------------------------------------------------------------

/**
 * Keyed on the record's version so that a materially updated record alerts
 * again, while a re-run of the same job over the same version does not.
 */
export function alertDedupeKey(
  kind: Exclude<AlertKind, 'closing_soon'>,
  opportunityId: string,
  versionNumber: number,
): string {
  return `${kind}:${opportunityId}:v${versionNumber}`;
}

export { reminderDedupeKey };

// ---------------------------------------------------------------------------
// Common gates
// ---------------------------------------------------------------------------

function commonGates(
  candidate: AlertCandidate,
  recipient: AlertRecipient,
  alertType: string,
): AlertDecision | null {
  if (recipient.accountStatus !== 'active') return decline('account_inactive');
  if (!recipient.emailAlertsEnabled) return decline('alerts_disabled');
  if (recipient.disabledAlertTypes.has(alertType)) {
    return decline('alert_type_disabled');
  }
  if (candidate.workflowStatus !== 'published' || candidate.isRestricted) {
    return decline('not_published');
  }
  if (recipient.accessRank < candidate.minimumAccessRank) {
    return decline('insufficient_access_rank');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function shouldSendHighScoreAlert(
  candidate: AlertCandidate,
  recipient: AlertRecipient,
): AlertDecision {
  const gate = commonGates(candidate, recipient, 'high_score');
  if (gate) return gate;

  // Immediate alerts are a Premium capability (spec 6).
  if (!recipient.immediateAlertsEntitled) return decline('not_entitled');

  if (candidate.score < recipient.minimumScore) {
    return decline('below_minimum_score');
  }
  if (!matchesFilters(candidate, recipient.filters)) {
    return decline('filters_not_matched');
  }

  const dedupeKey = alertDedupeKey(
    'high_score',
    candidate.opportunityId,
    candidate.versionNumber,
  );
  if (recipient.deliveredKeys.has(dedupeKey)) return decline('already_sent');

  return { send: true, reason: 'match', dedupeKey };
}

/** The field changes spec 18 treats as material. */
export const MATERIAL_FIELDS = [
  'closing_date',
  'opening_date',
  'eligibility_summary',
  'estimated_value_min',
  'estimated_value_max',
  'capital_required_min',
  'capital_required_max',
  'asking_price',
  'minimum_amount',
  'maximum_amount',
  'risk_summary',
  'restrictions',
  'status',
  'original_source_url',
] as const;

export function isMaterialChange(changedFields: readonly string[]): boolean {
  const material = new Set<string>(MATERIAL_FIELDS);
  return changedFields.some((field) => material.has(field));
}

export function shouldSendMaterialUpdateAlert(
  candidate: AlertCandidate,
  recipient: AlertRecipient,
  changedFields: readonly string[],
): AlertDecision {
  const gate = commonGates(candidate, recipient, 'material_update');
  if (gate) return gate;

  if (!isMaterialChange(changedFields)) return decline('filters_not_matched');
  if (!matchesFilters(candidate, recipient.filters)) {
    return decline('filters_not_matched');
  }

  const dedupeKey = alertDedupeKey(
    'material_update',
    candidate.opportunityId,
    candidate.versionNumber,
  );
  if (recipient.deliveredKeys.has(dedupeKey)) return decline('already_sent');

  return { send: true, reason: 'match', dedupeKey };
}

export function shouldSendClosingSoonAlert(
  candidate: AlertCandidate,
  recipient: AlertRecipient,
  now: Date = new Date(),
): AlertDecision {
  const gate = commonGates(candidate, recipient, 'closing_soon');
  if (gate) return gate;

  if (candidate.isExpired) return decline('expired');
  if (!candidate.closingDate) return decline('no_deadline');

  // A deadline we have not confirmed is not something to push someone toward.
  if (candidate.verificationStatus !== 'verified') {
    return decline('deadline_unverified');
  }

  const interval = dueReminderInterval(candidate.closingDate, now);
  if (interval === null) return decline('no_reminder_due');

  const dedupeKey = reminderDedupeKey(
    candidate.opportunityId,
    candidate.closingDate,
    interval,
  );
  if (recipient.deliveredKeys.has(dedupeKey)) return decline('already_sent');

  return { send: true, reason: 'match', dedupeKey };
}
