import { describe, expect, it } from 'vitest';

import {
  ANONYMOUS_VIEWER,
  buildViewer,
  canExportCsv,
  canSaveOpportunity,
  canSaveSearch,
  canViewReport,
  decideOpportunityView,
  resolvePageSize,
  type Viewer,
} from '@/lib/access/entitlements';
import { ACCESS_RANK, PLAN_FEATURE_DEFAULTS } from '@/lib/access/ranks';

function viewer(overrides: Partial<Viewer>): Viewer {
  return {
    userId: 'user-1',
    role: 'member',
    accountStatus: 'active',
    accessRank: ACCESS_RANK.free,
    planCode: 'free',
    features: PLAN_FEATURE_DEFAULTS.free,
    isStaff: false,
    isAuthenticated: true,
    ...overrides,
  };
}

const premium = viewer({
  accessRank: ACCESS_RANK.premium,
  planCode: 'premium',
  features: PLAN_FEATURE_DEFAULTS.premium,
});
const weekly = viewer({
  accessRank: ACCESS_RANK.weekly,
  planCode: 'weekly',
  features: PLAN_FEATURE_DEFAULTS.weekly,
});
const detailed = viewer({
  accessRank: ACCESS_RANK.detailed,
  planCode: 'detailed',
  features: PLAN_FEATURE_DEFAULTS.detailed,
});

const publishedRecord = {
  workflowStatus: 'published',
  isRestricted: false,
  minimumAccessRank: ACCESS_RANK.weekly,
};

describe('decideOpportunityView (spec 9, 14.3)', () => {
  it('an unpublished record is invisible to members, whatever their plan', () => {
    const decision = decideOpportunityView(premium, {
      ...publishedRecord,
      workflowStatus: 'draft',
    });
    expect(decision.canViewFull).toBe(false);
    expect(decision.decision.reason).toBe('not_published');
  });

  it('a restricted record is withheld even from qualifying plans', () => {
    const decision = decideOpportunityView(premium, {
      ...publishedRecord,
      isRestricted: true,
    });
    expect(decision.canViewFull).toBe(false);
  });

  it('a rank below the record yields a preview and an upgrade prompt', () => {
    const decision = decideOpportunityView(viewer({}), publishedRecord);
    expect(decision.detailLevel).toBe('preview');
    expect(decision.decision.reason).toBe('upgrade_required');
    expect(decision.decision.requiredPlan).toBe('weekly');
    expect(decision.lockedSections.length).toBeGreaterThan(0);
  });

  it('a Weekly member gets summary detail on a rank-10 record', () => {
    const decision = decideOpportunityView(weekly, publishedRecord);
    expect(decision.detailLevel).toBe('summary');
    expect(decision.canViewFull).toBe(false);
    // The locked list must name the exact features withheld (spec 14.3).
    expect(decision.lockedSections).toContain('Full analysis');
    expect(decision.decision.requiredPlan).toBe('detailed');
  });

  it('Detailed and Premium members read the record in full', () => {
    expect(decideOpportunityView(detailed, publishedRecord).canViewFull).toBe(true);
    expect(decideOpportunityView(premium, publishedRecord).canViewFull).toBe(true);
  });

  it('staff preview everything; suspended staff preview nothing', () => {
    const staff = viewer({ role: 'editor', isStaff: true, accessRank: 100 });
    expect(
      decideOpportunityView(staff, { ...publishedRecord, workflowStatus: 'draft' })
        .canViewFull,
    ).toBe(true);

    const suspendedStaff = viewer({
      role: 'editor',
      isStaff: true,
      accountStatus: 'suspended',
    });
    expect(decideOpportunityView(suspendedStaff, publishedRecord).canViewFull).toBe(
      false,
    );
  });

  it('a suspended member loses full detail', () => {
    const suspended = viewer({
      accessRank: ACCESS_RANK.premium,
      planCode: 'premium',
      features: PLAN_FEATURE_DEFAULTS.premium,
      accountStatus: 'suspended',
    });
    const decision = decideOpportunityView(suspended, publishedRecord);
    expect(decision.canViewFull).toBe(false);
    expect(decision.decision.reason).toBe('account_suspended');
  });
});

describe('saved-opportunity limits (spec 6)', () => {
  it('Free saves exactly one and is pointed at Weekly next', () => {
    expect(canSaveOpportunity(viewer({}), 0).allowed).toBe(true);
    const denied = canSaveOpportunity(viewer({}), 1);
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('limit_reached');
    expect(denied.requiredPlan).toBe('weekly');
  });

  it('Weekly saves 25', () => {
    expect(canSaveOpportunity(weekly, 24).allowed).toBe(true);
    expect(canSaveOpportunity(weekly, 25).allowed).toBe(false);
  });

  it('Detailed and Premium are unlimited', () => {
    expect(canSaveOpportunity(detailed, 10_000).allowed).toBe(true);
    expect(canSaveOpportunity(premium, 10_000).allowed).toBe(true);
  });

  it('anonymous callers are asked to sign in', () => {
    expect(canSaveOpportunity(ANONYMOUS_VIEWER, 0).reason).toBe(
      'authentication_required',
    );
  });
});

describe('saved searches and export (spec 6)', () => {
  it('only Premium may save searches', () => {
    expect(canSaveSearch(viewer({}), 0).reason).toBe('upgrade_required');
    expect(canSaveSearch(weekly, 0).reason).toBe('upgrade_required');
    expect(canSaveSearch(detailed, 0).reason).toBe('upgrade_required');
    expect(canSaveSearch(premium, 0).allowed).toBe(true);
  });

  it('only Premium may export CSV, and suspension blocks it', () => {
    expect(canExportCsv(detailed).reason).toBe('upgrade_required');
    expect(canExportCsv(premium).allowed).toBe(true);
    expect(
      canExportCsv({ ...premium, accountStatus: 'suspended' }).reason,
    ).toBe('account_suspended');
  });
});

describe('report access', () => {
  it('samples are readable by everyone, including signed-out visitors', () => {
    expect(
      canViewReport(ANONYMOUS_VIEWER, {
        minimumAccessRank: 30,
        isSample: true,
        status: 'published',
      }).allowed,
    ).toBe(true);
  });

  it('tier gating applies to real reports', () => {
    const decision = canViewReport(weekly, {
      minimumAccessRank: 20,
      isSample: false,
      status: 'published',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.requiredPlan).toBe('detailed');
  });
});

describe('page size (spec 11)', () => {
  it('caps at the plan maximum', () => {
    expect(resolvePageSize(viewer({}), 100)).toBe(20);
    expect(resolvePageSize(weekly, 100)).toBe(50);
    expect(resolvePageSize(premium, 100)).toBe(100);
  });

  it('nonsense requests fall back to a sane default', () => {
    expect(resolvePageSize(premium, -3)).toBe(20);
    expect(resolvePageSize(premium, Number.NaN)).toBe(20);
  });
});

describe('buildViewer', () => {
  it('staff viewers preview the richest feature set', () => {
    const staff = buildViewer(
      {
        userId: 'staff-1',
        role: 'reviewer',
        accountStatus: 'active',
        accessRankOverride: null,
        accessRankOverrideExpiresAt: null,
      },
      null,
      null,
    );
    expect(staff.accessRank).toBe(ACCESS_RANK.staff);
    expect(staff.features.opportunityDetail).toBe('complete');
  });
});
