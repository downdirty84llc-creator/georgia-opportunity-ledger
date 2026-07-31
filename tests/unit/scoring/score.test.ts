import { describe, expect, it } from 'vitest';

import {
  applyManualAdjustment,
  buildScore,
  calculateTotal,
  classifyScore,
  clampComponents,
  explainScore,
  MAX_MANUAL_ADJUSTMENT,
  MAX_SCORE,
  SCORE_MAXIMA,
  scoreAccessibility,
  scoreBreakdown,
  scoreCapitalRequirement,
  scoreComplexity,
  scoreFinancialValue,
  scoreRisk,
  scoreSourceReliability,
  scoreTimeSensitivity,
  SOURCE_TIER_SCORES,
} from '@/lib/scoring/score';

describe('score arithmetic (spec 12)', () => {
  it('component maxima sum to exactly 100', () => {
    const total = Object.values(SCORE_MAXIMA).reduce(
      (sum, max) => sum + max,
      0,
    );
    expect(total).toBe(MAX_SCORE);
  });

  it('clamps components to their documented maxima', () => {
    const clamped = clampComponents({
      financialValue: 99,
      accessibility: -5,
      timeSensitivity: 15.4,
      sourceReliability: 15,
      capitalRequirement: 10,
      complexity: 10,
      risk: 5,
    });
    expect(clamped.financialValue).toBe(25);
    expect(clamped.accessibility).toBe(0);
    expect(clamped.timeSensitivity).toBe(15);
  });

  it('a perfect record scores 100', () => {
    expect(
      calculateTotal({
        financialValue: 25,
        accessibility: 20,
        timeSensitivity: 15,
        sourceReliability: 15,
        capitalRequirement: 10,
        complexity: 10,
        risk: 5,
      }),
    ).toBe(100);
  });

  it('NaN components are treated as zero, not propagated', () => {
    expect(calculateTotal({ financialValue: Number.NaN })).toBe(0);
  });
});

describe('manual adjustment', () => {
  it('applies within bounds and clamps the result to 0..100', () => {
    expect(applyManualAdjustment(90, 25)).toBe(100);
    expect(applyManualAdjustment(10, -25)).toBe(0);
    expect(applyManualAdjustment(50, 10)).toBe(60);
  });

  it('caps the adjustment magnitude at ±25', () => {
    expect(applyManualAdjustment(50, 60)).toBe(50 + MAX_MANUAL_ADJUSTMENT);
    expect(applyManualAdjustment(50, -60)).toBe(50 - MAX_MANUAL_ADJUSTMENT);
  });
});

describe('classification bands (spec 12)', () => {
  // Band edges are the values people argue about; test every one.
  const cases: Array<[number, string]> = [
    [100, 'immediate_action'],
    [85, 'immediate_action'],
    [84, 'strong_opportunity'],
    [70, 'strong_opportunity'],
    [69, 'worth_investigating'],
    [55, 'worth_investigating'],
    [54, 'limited_or_specialized'],
    [40, 'limited_or_specialized'],
    [39, 'information_only'],
    [0, 'information_only'],
  ];

  it.each(cases)('score %i classifies as %s', (score, expected) => {
    expect(classifyScore(score)).toBe(expected);
  });

  it('clamps out-of-range scores instead of failing', () => {
    expect(classifyScore(150)).toBe('immediate_action');
    expect(classifyScore(-10)).toBe('information_only');
  });
});

describe('financial value derivation', () => {
  it('uses the midpoint of the estimated range', () => {
    // Midpoint 3M → the 1M–5M band.
    expect(
      scoreFinancialValue({
        estimatedValueMin: 1_000_000,
        estimatedValueMax: 5_000_000,
      }),
    ).toBe(21);
  });

  it('scores 0 when nothing is known', () => {
    expect(scoreFinancialValue({})).toBe(0);
  });

  it('tops out at 25 for very large values', () => {
    expect(scoreFinancialValue({ estimatedValueMin: 10_000_000 })).toBe(25);
  });
});

describe('accessibility derivation', () => {
  it('starts at the maximum with no barriers', () => {
    expect(scoreAccessibility({})).toBe(SCORE_MAXIMA.accessibility);
  });

  it('compounds deductions for stacked barriers', () => {
    const constrained = scoreAccessibility({
      geographicScope: 'single_county',
      industryRestricted: true,
      revenueRequirement: true,
      licensingRequirement: true,
      timeInBusinessRequirement: true,
      ownerContributionPercent: 30,
    });
    expect(constrained).toBe(20 - 4 - 4 - 3 - 3 - 2 - 2);
  });

  it('never goes below zero', () => {
    expect(
      scoreAccessibility({
        geographicScope: 'single_county',
        industryRestricted: true,
        revenueRequirement: true,
        licensingRequirement: true,
        timeInBusinessRequirement: true,
        ownerContributionPercent: 90,
      }),
    ).toBeGreaterThanOrEqual(0);
  });
});

describe('time sensitivity derivation', () => {
  const now = new Date('2026-07-01T00:00:00Z');

  it('scores higher as the deadline approaches', () => {
    const far = scoreTimeSensitivity({
      closingDate: new Date('2026-12-01T00:00:00Z'),
      now,
    });
    const near = scoreTimeSensitivity({
      closingDate: new Date('2026-07-05T00:00:00Z'),
      now,
    });
    expect(near).toBeGreaterThan(far);
  });

  it('gives a record with no deadline a small non-zero score', () => {
    expect(scoreTimeSensitivity({ now })).toBe(3);
  });

  it('scores an expired deadline zero, with no bonuses', () => {
    expect(
      scoreTimeSensitivity({
        closingDate: new Date('2026-06-01T00:00:00Z'),
        now,
        firstComeFirstServed: true,
        limitedInventory: true,
      }),
    ).toBe(0);
  });

  it('adds first-come and limited-inventory bonuses within the cap', () => {
    const withBonuses = scoreTimeSensitivity({
      closingDate: new Date('2026-07-03T00:00:00Z'),
      now,
      firstComeFirstServed: true,
      limitedInventory: true,
    });
    expect(withBonuses).toBe(15); // 15 base capped at maximum
  });
});

describe('source reliability (spec 12 fixed values)', () => {
  it('matches the specified tier values exactly', () => {
    expect(SOURCE_TIER_SCORES.primary_government).toBe(15);
    expect(SOURCE_TIER_SCORES.authorized_official).toBe(13);
    expect(SOURCE_TIER_SCORES.licensed).toBe(11);
    expect(SOURCE_TIER_SCORES.verified_secondary).toBe(8);
    expect(SOURCE_TIER_SCORES.unverified_lead).toBe(3);
  });

  it('clamps raw reliability scores into range', () => {
    expect(scoreSourceReliability({ reliabilityScore: 40 })).toBe(15);
    expect(scoreSourceReliability({ reliabilityScore: -3 })).toBe(0);
  });
});

describe('capital requirement derivation', () => {
  it('scores lower capital higher', () => {
    expect(scoreCapitalRequirement({ capitalRequiredMin: 0 })).toBe(10);
    expect(scoreCapitalRequirement({ capitalRequiredMin: 5_000_000 })).toBe(1);
  });

  it('treats unknown capital as neutral, not free', () => {
    expect(scoreCapitalRequirement({})).toBe(5);
  });

  it('uses the smaller of capital and deposit', () => {
    expect(
      scoreCapitalRequirement({
        capitalRequiredMin: 500_000,
        depositRequired: 20_000,
      }),
    ).toBe(8);
  });
});

describe('complexity and risk derivation', () => {
  it('lower complexity scores higher', () => {
    expect(scoreComplexity('low')).toBeGreaterThan(
      scoreComplexity('very_high'),
    );
  });
  it('lower risk scores higher', () => {
    expect(scoreRisk('low')).toBe(5);
    expect(scoreRisk('severe')).toBe(0);
  });
});

describe('explanation and assembly', () => {
  const components = {
    financialValue: 21,
    accessibility: 16,
    timeSensitivity: 11,
    sourceReliability: 15,
    capitalRequirement: 7,
    complexity: 7,
    risk: 3,
  };

  it('assembles a complete result with matching totals', () => {
    const result = buildScore(components, {
      manualAdjustment: 5,
      adjustmentReason: 'Site visit confirmed better condition than listed.',
    });
    expect(result.calculatedTotal).toBe(80);
    expect(result.finalTotal).toBe(85);
    expect(result.classification).toBe('immediate_action');
    expect(result.breakdown).toHaveLength(7);
  });

  it('mentions the adjustment and its reason in the explanation', () => {
    const text = explainScore(components, {
      manualAdjustment: 5,
      adjustmentReason: 'Site visit confirmed better condition than listed.',
    });
    expect(text).toContain('raised');
    expect(text).toContain('Site visit confirmed');
  });

  it('breakdown ratios are proportions of each maximum', () => {
    const rows = scoreBreakdown(components);
    const financial = rows.find((row) => row.key === 'financialValue');
    expect(financial?.ratio).toBeCloseTo(21 / 25);
  });
});
