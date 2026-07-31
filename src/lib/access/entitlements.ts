/**
 * Entitlement decisions: what a given viewer may do, and what to tell them
 * when they may not.
 *
 * Every gate returns a decision object rather than a boolean. A bare `false`
 * produces the worst version of this product — a dead button with no
 * explanation — whereas a decision carries the reason, the plan that would
 * unlock it, and the sentence to show. Spec 14.3 requires the locked state to
 * name the exact feature needed.
 */

import {
  ACCESS_RANK,
  featuresForRank,
  planCodeForRank,
  PLAN_FEATURE_DEFAULTS,
  PLAN_RANK,
  type PlanCode,
  type PlanFeatures,
  type OpportunityDetailLevel,
} from '@/lib/access/ranks';
import {
  effectiveAccessRank,
  isStaffRole,
  type AccountStatus,
  type ProfileAccessInput,
  type SubscriptionRecord,
  type UserRole,
} from '@/lib/billing/subscription';

export interface Viewer {
  userId: string | null;
  role: UserRole;
  accountStatus: AccountStatus;
  accessRank: number;
  planCode: PlanCode;
  features: PlanFeatures;
  isStaff: boolean;
  isAuthenticated: boolean;
}

export const ANONYMOUS_VIEWER: Viewer = {
  userId: null,
  role: 'visitor',
  accountStatus: 'active',
  accessRank: ACCESS_RANK.free,
  planCode: 'free',
  features: PLAN_FEATURE_DEFAULTS.free,
  isStaff: false,
  isAuthenticated: false,
};

export function buildViewer(
  profile: ProfileAccessInput & { userId: string },
  subscription: SubscriptionRecord | null,
  planFeatures: PlanFeatures | null,
  now: Date = new Date(),
): Viewer {
  const accessRank = effectiveAccessRank(profile, subscription, now);
  const planCode = planCodeForRank(accessRank);
  return {
    userId: profile.userId,
    role: profile.role,
    accountStatus: profile.accountStatus,
    accessRank,
    planCode,
    // Staff preview the richest tier; members get their own plan's document
    // when the database supplied one, otherwise the compiled default.
    features:
      !isStaffRole(profile.role) && planFeatures
        ? planFeatures
        : featuresForRank(accessRank),
    isStaff: isStaffRole(profile.role),
    isAuthenticated: true,
  };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface Decision {
  allowed: boolean;
  /** Machine-readable reason, used for analytics and API error codes. */
  reason:
    | 'allowed'
    | 'authentication_required'
    | 'upgrade_required'
    | 'account_suspended'
    | 'limit_reached'
    | 'not_published';
  /** One sentence for the member. Written to be shown verbatim. */
  message: string;
  /** The plan that would satisfy the gate, when upgrading is the answer. */
  requiredPlan?: PlanCode;
  requiredRank?: number;
}

const PLAN_NAMES: Readonly<Record<PlanCode, string>> = {
  free: 'Free Preview',
  weekly: 'Weekly Report',
  detailed: 'Detailed Intelligence',
  premium: 'Premium Alerts and Database',
};

export function planName(code: PlanCode): string {
  return PLAN_NAMES[code];
}

const ALLOWED: Decision = {
  allowed: true,
  reason: 'allowed',
  message: '',
};

function suspended(action: string): Decision {
  return {
    allowed: false,
    reason: 'account_suspended',
    message:
      `Your account is suspended, so ${action} is unavailable. ` +
      'Contact support to appeal.',
  };
}

function needsAuth(action: string): Decision {
  return {
    allowed: false,
    reason: 'authentication_required',
    message: `Sign in to ${action}.`,
  };
}

function needsUpgrade(requiredPlan: PlanCode, capability: string): Decision {
  return {
    allowed: false,
    reason: 'upgrade_required',
    message: `${capability} is included with ${PLAN_NAMES[requiredPlan]}.`,
    requiredPlan,
    requiredRank: PLAN_RANK[requiredPlan],
  };
}

/**
 * The detail level a viewer gets for a specific record.
 *
 * Two things are being decided at once: whether the viewer's plan is rich
 * enough for the record's own minimum rank, and how much of *any* record their
 * plan renders. A Weekly member looking at a rank-0 record still only sees
 * summary detail.
 */
export interface OpportunityViewDecision {
  /** May the full record be read at all? */
  canViewFull: boolean;
  detailLevel: OpportunityDetailLevel;
  lockedSections: string[];
  decision: Decision;
}

export const DETAIL_SECTIONS_BY_LEVEL: Readonly<
  Record<OpportunityDetailLevel, readonly string[]>
> = {
  preview: ['Title', 'Category', 'County', 'Score', 'Deadline'],
  summary: [
    'Title',
    'Category',
    'County',
    'Score',
    'Deadline',
    'Executive summary',
    'Financial overview',
    'Source information',
  ],
  complete: [
    'Title',
    'Category',
    'County',
    'Score',
    'Score explanation',
    'Deadline',
    'Executive summary',
    'Full analysis',
    'Financial overview',
    'Eligibility and property details',
    'Why it matters',
    'Risk factors',
    'Recommended next action',
    'Required documents',
    'Timeline',
    'Source information',
  ],
};

function lockedSectionsFor(level: OpportunityDetailLevel): string[] {
  const shown = new Set(DETAIL_SECTIONS_BY_LEVEL[level]);
  return DETAIL_SECTIONS_BY_LEVEL.complete.filter(
    (section) => !shown.has(section),
  );
}

/** The lowest plan whose detail level is `complete`. */
export function planForCompleteDetail(): PlanCode {
  return 'detailed';
}

export function decideOpportunityView(
  viewer: Viewer,
  record: {
    workflowStatus: string;
    isRestricted: boolean;
    minimumAccessRank: number;
  },
): OpportunityViewDecision {
  if (viewer.isStaff && viewer.accountStatus === 'active') {
    return {
      canViewFull: true,
      detailLevel: 'complete',
      lockedSections: [],
      decision: ALLOWED,
    };
  }

  if (record.workflowStatus !== 'published' || record.isRestricted) {
    return {
      canViewFull: false,
      detailLevel: 'preview',
      lockedSections: lockedSectionsFor('preview'),
      decision: {
        allowed: false,
        reason: 'not_published',
        message: 'This record is not currently published.',
      },
    };
  }

  if (viewer.accountStatus !== 'active') {
    return {
      canViewFull: false,
      detailLevel: 'preview',
      lockedSections: lockedSectionsFor('preview'),
      decision: suspended('opportunity detail'),
    };
  }

  // Gate 1: is the viewer's rank high enough for this particular record?
  if (viewer.accessRank < record.minimumAccessRank) {
    const requiredPlan = planCodeForRank(record.minimumAccessRank);
    return {
      canViewFull: false,
      detailLevel: 'preview',
      lockedSections: lockedSectionsFor('preview'),
      decision: needsUpgrade(requiredPlan, 'This record'),
    };
  }

  // Gate 2: how much detail does the viewer's own plan render?
  const level = viewer.features.opportunityDetail;
  if (level === 'complete') {
    return {
      canViewFull: true,
      detailLevel: 'complete',
      lockedSections: [],
      decision: ALLOWED,
    };
  }

  return {
    canViewFull: false,
    detailLevel: level,
    lockedSections: lockedSectionsFor(level),
    decision: needsUpgrade(
      planForCompleteDetail(),
      'Full analysis, score explanations and risk factors',
    ),
  };
}

// ---------------------------------------------------------------------------
// Feature gates
// ---------------------------------------------------------------------------

export function canExportCsv(viewer: Viewer): Decision {
  if (!viewer.isAuthenticated) return needsAuth('export records');
  if (viewer.accountStatus !== 'active') return suspended('exporting');
  if (viewer.isStaff) return ALLOWED;
  if (!viewer.features.csvExport) {
    return needsUpgrade('premium', 'CSV export');
  }
  return ALLOWED;
}

export function canSaveSearch(viewer: Viewer, currentCount: number): Decision {
  if (!viewer.isAuthenticated) return needsAuth('save a search');
  if (viewer.accountStatus !== 'active') return suspended('saved searches');

  const limit = viewer.features.savedSearchLimit;
  if (!viewer.isStaff && limit !== null && limit <= 0) {
    return needsUpgrade('premium', 'Saved searches');
  }
  if (limit !== null && currentCount >= limit) {
    return {
      allowed: false,
      reason: 'limit_reached',
      message: `You have reached your limit of ${limit} saved searches.`,
    };
  }
  return ALLOWED;
}

export function canSaveOpportunity(
  viewer: Viewer,
  currentCount: number,
): Decision {
  if (!viewer.isAuthenticated) return needsAuth('save an opportunity');
  if (viewer.accountStatus !== 'active') return suspended('saving records');

  const limit = viewer.features.savedOpportunityLimit;
  if (limit === null) return ALLOWED;

  if (currentCount >= limit) {
    // The upgrade that actually helps depends on where they are: a Free member
    // at 1 saved record should be pointed at Weekly, not straight at Premium.
    const nextPlan: PlanCode =
      viewer.planCode === 'free' ? 'weekly' : 'detailed';
    return {
      allowed: false,
      reason: 'limit_reached',
      message:
        `Your plan saves up to ${limit} ` +
        `opportunit${limit === 1 ? 'y' : 'ies'}. ` +
        `${PLAN_NAMES[nextPlan]} raises that limit.`,
      requiredPlan: nextPlan,
      requiredRank: PLAN_RANK[nextPlan],
    };
  }
  return ALLOWED;
}

export function canReceiveImmediateAlerts(viewer: Viewer): Decision {
  if (!viewer.isAuthenticated) return needsAuth('receive alerts');
  if (viewer.accountStatus !== 'active') return suspended('alerts');
  if (viewer.isStaff) return ALLOWED;
  if (!viewer.features.immediateAlerts) {
    return needsUpgrade('premium', 'Immediate alerts');
  }
  return ALLOWED;
}

export function canUseAdvancedFilters(viewer: Viewer): Decision {
  if (viewer.isStaff) return ALLOWED;
  if (!viewer.features.advancedFilters) {
    return needsUpgrade('detailed', 'Advanced filters');
  }
  return ALLOWED;
}

export function canViewDeadlineCalendar(viewer: Viewer): Decision {
  if (!viewer.isAuthenticated) return needsAuth('view the deadline calendar');
  if (viewer.accountStatus !== 'active') return suspended('the calendar');
  if (viewer.isStaff) return ALLOWED;
  if (!viewer.features.deadlineCalendar) {
    return needsUpgrade('weekly', 'The deadline calendar');
  }
  return ALLOWED;
}

export function canViewPricingDashboard(viewer: Viewer): Decision {
  if (viewer.isStaff) return ALLOWED;
  if (viewer.features.pricingDashboard !== 'complete') {
    return needsUpgrade('detailed', 'The complete pricing dashboard');
  }
  return ALLOWED;
}

export function canViewReport(
  viewer: Viewer,
  report: { minimumAccessRank: number; isSample: boolean; status: string },
): Decision {
  if (viewer.isStaff && viewer.accountStatus === 'active') return ALLOWED;
  if (report.status !== 'published') {
    return {
      allowed: false,
      reason: 'not_published',
      message: 'This report has not been published yet.',
    };
  }
  if (report.isSample) return ALLOWED;
  if (!viewer.isAuthenticated) return needsAuth('read this report');
  if (viewer.accountStatus !== 'active') return suspended('reports');
  if (viewer.accessRank < report.minimumAccessRank) {
    return needsUpgrade(
      planCodeForRank(report.minimumAccessRank),
      'This report',
    );
  }
  return ALLOWED;
}

/** Page size, capped by plan (spec 11: 100 rows is a Premium capability). */
export function resolvePageSize(viewer: Viewer, requested: number): number {
  const max = viewer.isStaff ? 100 : viewer.features.maxPageSize;
  if (!Number.isFinite(requested) || requested <= 0) return Math.min(20, max);
  return Math.min(Math.trunc(requested), max);
}
