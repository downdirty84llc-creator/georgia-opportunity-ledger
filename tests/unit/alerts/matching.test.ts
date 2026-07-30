import { describe, expect, it } from 'vitest';

import {
  alertDedupeKey,
  isMaterialChange,
  matchesFilters,
  shouldSendClosingSoonAlert,
  shouldSendHighScoreAlert,
  shouldSendMaterialUpdateAlert,
  type AlertCandidate,
  type AlertRecipient,
} from '@/lib/alerts/matching';
import { parseStoredFilters } from '@/lib/search/filters';

const NOW = new Date('2026-07-15T12:00:00Z');

function candidate(overrides: Partial<AlertCandidate> = {}): AlertCandidate {
  return {
    opportunityId: 'opp-1',
    versionNumber: 1,
    score: 88,
    category: 'commercial_property',
    status: 'open',
    countyId: 'county-1',
    cityId: null,
    stateId: 'state-1',
    industryIds: ['industry-1'],
    propertyType: 'warehouse',
    fundingType: null,
    capitalRequiredMin: 100_000,
    estimatedValueMax: 1_000_000,
    minimumAccessRank: 30,
    closingDate: new Date('2026-07-25T00:00:00Z'),
    isExpired: false,
    verificationStatus: 'verified',
    publishedAt: NOW,
    isRestricted: false,
    workflowStatus: 'published',
    ...overrides,
  };
}

function recipient(overrides: Partial<AlertRecipient> = {}): AlertRecipient {
  return {
    userId: 'user-1',
    accessRank: 30,
    accountStatus: 'active',
    emailAlertsEnabled: true,
    immediateAlertsEntitled: true,
    minimumScore: 70,
    filters: parseStoredFilters({}),
    disabledAlertTypes: new Set(),
    deliveredKeys: new Set(),
    ...overrides,
  };
}

describe('high-score alert (spec 18)', () => {
  it('sends when every condition holds', () => {
    const decision = shouldSendHighScoreAlert(candidate(), recipient());
    expect(decision.send).toBe(true);
    expect(decision.dedupeKey).toBe('high_score:opp-1:v1');
  });

  it('declines below the member minimum score', () => {
    expect(
      shouldSendHighScoreAlert(candidate({ score: 60 }), recipient()).reason,
    ).toBe('below_minimum_score');
  });

  it('declines without the Premium entitlement', () => {
    expect(
      shouldSendHighScoreAlert(
        candidate(),
        recipient({ immediateAlertsEntitled: false }),
      ).reason,
    ).toBe('not_entitled');
  });

  it('declines when the member cannot open the record', () => {
    expect(
      shouldSendHighScoreAlert(candidate(), recipient({ accessRank: 10 })).reason,
    ).toBe('insufficient_access_rank');
  });

  it('declines for suspended accounts, disabled alerts, and unpublished records', () => {
    expect(
      shouldSendHighScoreAlert(
        candidate(),
        recipient({ accountStatus: 'suspended' }),
      ).reason,
    ).toBe('account_inactive');
    expect(
      shouldSendHighScoreAlert(
        candidate(),
        recipient({ emailAlertsEnabled: false }),
      ).reason,
    ).toBe('alerts_disabled');
    expect(
      shouldSendHighScoreAlert(
        candidate({ workflowStatus: 'draft' }),
        recipient(),
      ).reason,
    ).toBe('not_published');
  });

  it('never sends the same version twice', () => {
    const delivered = recipient({
      deliveredKeys: new Set([alertDedupeKey('high_score', 'opp-1', 1)]),
    });
    expect(shouldSendHighScoreAlert(candidate(), delivered).reason).toBe(
      'already_sent',
    );
    // A new version is a new event.
    expect(
      shouldSendHighScoreAlert(candidate({ versionNumber: 2 }), delivered).send,
    ).toBe(true);
  });

  it('respects the member filters', () => {
    const fundingOnly = recipient({
      filters: parseStoredFilters({ category: 'business_funding' }),
    });
    expect(shouldSendHighScoreAlert(candidate(), fundingOnly).reason).toBe(
      'filters_not_matched',
    );
  });
});

describe('material update alert (spec 18)', () => {
  it('the material field list matches the specification', () => {
    expect(isMaterialChange(['closing_date'])).toBe(true);
    expect(isMaterialChange(['eligibility_summary'])).toBe(true);
    expect(isMaterialChange(['maximum_amount'])).toBe(true);
    expect(isMaterialChange(['asking_price'])).toBe(true);
    expect(isMaterialChange(['status'])).toBe(true);
    expect(isMaterialChange(['risk_summary'])).toBe(true);
    expect(isMaterialChange(['original_source_url'])).toBe(true);
    expect(isMaterialChange(['internal_notes'])).toBe(false);
    expect(isMaterialChange([])).toBe(false);
  });

  it('sends only for material changes', () => {
    expect(
      shouldSendMaterialUpdateAlert(candidate(), recipient(), ['closing_date'])
        .send,
    ).toBe(true);
    expect(
      shouldSendMaterialUpdateAlert(candidate(), recipient(), ['internal_notes'])
        .reason,
    ).toBe('filters_not_matched');
  });
});

describe('closing-soon alert (spec 18)', () => {
  it('sends inside a reminder interval', () => {
    const decision = shouldSendClosingSoonAlert(
      candidate({ closingDate: new Date('2026-07-20T00:00:00Z') }),
      recipient(),
      NOW,
    );
    expect(decision.send).toBe(true);
    // 5 days out lands in the 7-day interval.
    expect(decision.dedupeKey).toBe('deadline:opp-1:2026-07-20:7');
  });

  it('never alerts on an expired record', () => {
    expect(
      shouldSendClosingSoonAlert(candidate({ isExpired: true }), recipient(), NOW)
        .reason,
    ).toBe('expired');
  });

  it('never alerts on an unverified deadline', () => {
    expect(
      shouldSendClosingSoonAlert(
        candidate({ verificationStatus: 'pending' }),
        recipient(),
        NOW,
      ).reason,
    ).toBe('deadline_unverified');
  });

  it('a rescheduled deadline produces a new key and fires again', () => {
    const firstKey = 'deadline:opp-1:2026-07-20:7';
    const delivered = recipient({ deliveredKeys: new Set([firstKey]) });

    // Same deadline: suppressed.
    expect(
      shouldSendClosingSoonAlert(
        candidate({ closingDate: new Date('2026-07-20T00:00:00Z') }),
        delivered,
        NOW,
      ).reason,
    ).toBe('already_sent');

    // Deadline moved: the key changes, so the member is told again.
    expect(
      shouldSendClosingSoonAlert(
        candidate({ closingDate: new Date('2026-07-21T00:00:00Z') }),
        delivered,
        NOW,
      ).send,
    ).toBe(true);
  });

  it('no reminder fires far from the deadline', () => {
    expect(
      shouldSendClosingSoonAlert(
        candidate({ closingDate: new Date('2026-10-01T00:00:00Z') }),
        recipient(),
        NOW,
      ).reason,
    ).toBe('no_reminder_due');
  });
});

describe('matchesFilters edge cases', () => {
  it('an absent filter constrains nothing', () => {
    expect(matchesFilters(candidate(), parseStoredFilters({}))).toBe(true);
  });

  it('unknown capital is not excluded by a ceiling', () => {
    expect(
      matchesFilters(
        candidate({ capitalRequiredMin: null }),
        parseStoredFilters({ capitalMax: 50_000 }),
      ),
    ).toBe(true);
    expect(
      matchesFilters(
        candidate({ capitalRequiredMin: 100_000 }),
        parseStoredFilters({ capitalMax: 50_000 }),
      ),
    ).toBe(false);
  });

  it('industry matching accepts any overlap', () => {
    expect(
      matchesFilters(
        candidate({ industryIds: ['a', 'b'] }),
        parseStoredFilters({
          industryIds: [
            '11111111-1111-4111-8111-111111111111',
          ],
        }),
      ),
    ).toBe(false);
  });

  it('expired records are excluded unless asked for', () => {
    expect(
      matchesFilters(candidate({ isExpired: true }), parseStoredFilters({})),
    ).toBe(false);
    expect(
      matchesFilters(
        candidate({ isExpired: true }),
        parseStoredFilters({ includeExpired: true }),
      ),
    ).toBe(true);
  });
});
