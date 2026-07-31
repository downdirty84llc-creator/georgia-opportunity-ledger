/**
 * Opportunity scoring (spec section 12).
 *
 * Two layers live here:
 *
 *   1. The arithmetic — component maxima, the total, the manual adjustment and
 *      the classification bands. This is fixed by the specification and must
 *      not drift, because published scores are compared across records and
 *      across weeks.
 *
 *   2. The derivation helpers — how a researcher's structured inputs become a
 *      proposed component score. These are heuristics. A reviewer can override
 *      any of them, and the manual adjustment exists precisely so judgement can
 *      beat the formula, but an override without a written reason is rejected
 *      by the database.
 */

export const SCORE_MAXIMA = {
  financialValue: 25,
  accessibility: 20,
  timeSensitivity: 15,
  sourceReliability: 15,
  capitalRequirement: 10,
  complexity: 10,
  risk: 5,
} as const;

export const MAX_SCORE = 100;

/** The manual adjustment a reviewer may apply in either direction. */
export const MAX_MANUAL_ADJUSTMENT = 25;

export type ScoreComponentKey = keyof typeof SCORE_MAXIMA;

export type ScoreComponents = Record<ScoreComponentKey, number>;

export type ScoreClassification =
  | 'immediate_action'
  | 'strong_opportunity'
  | 'worth_investigating'
  | 'limited_or_specialized'
  | 'information_only';

export const CLASSIFICATION_BANDS: ReadonlyArray<{
  classification: ScoreClassification;
  min: number;
  max: number;
  label: string;
}> = [
  {
    classification: 'immediate_action',
    min: 85,
    max: 100,
    label: 'Immediate Action',
  },
  {
    classification: 'strong_opportunity',
    min: 70,
    max: 84,
    label: 'Strong Opportunity',
  },
  {
    classification: 'worth_investigating',
    min: 55,
    max: 69,
    label: 'Worth Investigating',
  },
  {
    classification: 'limited_or_specialized',
    min: 40,
    max: 54,
    label: 'Limited or Specialized',
  },
  {
    classification: 'information_only',
    min: 0,
    max: 39,
    label: 'Information Only',
  },
];

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Clamps every component to its documented maximum. */
export function clampComponents(
  components: Partial<ScoreComponents>,
): ScoreComponents {
  return {
    financialValue: clamp(
      components.financialValue ?? 0,
      0,
      SCORE_MAXIMA.financialValue,
    ),
    accessibility: clamp(
      components.accessibility ?? 0,
      0,
      SCORE_MAXIMA.accessibility,
    ),
    timeSensitivity: clamp(
      components.timeSensitivity ?? 0,
      0,
      SCORE_MAXIMA.timeSensitivity,
    ),
    sourceReliability: clamp(
      components.sourceReliability ?? 0,
      0,
      SCORE_MAXIMA.sourceReliability,
    ),
    capitalRequirement: clamp(
      components.capitalRequirement ?? 0,
      0,
      SCORE_MAXIMA.capitalRequirement,
    ),
    complexity: clamp(components.complexity ?? 0, 0, SCORE_MAXIMA.complexity),
    risk: clamp(components.risk ?? 0, 0, SCORE_MAXIMA.risk),
  };
}

export function calculateTotal(components: Partial<ScoreComponents>): number {
  const clamped = clampComponents(components);
  const total =
    clamped.financialValue +
    clamped.accessibility +
    clamped.timeSensitivity +
    clamped.sourceReliability +
    clamped.capitalRequirement +
    clamped.complexity +
    clamped.risk;
  return clamp(total, 0, MAX_SCORE);
}

export function applyManualAdjustment(
  calculatedTotal: number,
  adjustment: number,
): number {
  const bounded = clamp(
    adjustment,
    -MAX_MANUAL_ADJUSTMENT,
    MAX_MANUAL_ADJUSTMENT,
  );
  return clamp(calculatedTotal + bounded, 0, MAX_SCORE);
}

export function classifyScore(score: number): ScoreClassification {
  const bounded = clamp(score, 0, MAX_SCORE);
  const band = CLASSIFICATION_BANDS.find(
    (candidate) => bounded >= candidate.min && bounded <= candidate.max,
  );
  // Every value in 0..100 falls in a band; the fallback keeps the type total.
  return band?.classification ?? 'information_only';
}

export function classificationLabel(
  classification: ScoreClassification,
): string {
  return (
    CLASSIFICATION_BANDS.find((b) => b.classification === classification)
      ?.label ?? 'Information Only'
  );
}

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

/**
 * Financial value (max 25). Banded on the midpoint of the estimated value
 * range. Bands rather than a linear scale because the difference between a
 * $2M and a $2.2M opportunity is noise, while the difference between $50k and
 * $500k is a different kind of decision.
 */
export function scoreFinancialValue(input: {
  estimatedValueMin?: number | null;
  estimatedValueMax?: number | null;
}): number {
  const { estimatedValueMin, estimatedValueMax } = input;
  const values = [estimatedValueMin, estimatedValueMax].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  );
  if (values.length === 0) return 0;

  const midpoint =
    values.reduce((sum, value) => sum + value, 0) / values.length;

  if (midpoint >= 5_000_000) return 25;
  if (midpoint >= 1_000_000) return 21;
  if (midpoint >= 500_000) return 17;
  if (midpoint >= 250_000) return 13;
  if (midpoint >= 100_000) return 9;
  if (midpoint >= 25_000) return 5;
  if (midpoint > 0) return 2;
  return 0;
}

/**
 * Accessibility (max 20). Starts from "anyone in Georgia could pursue this"
 * and deducts for each barrier. The deductions are additive because barriers
 * compound: a single-county grant restricted to one industry with a revenue
 * floor is genuinely reachable by very few subscribers.
 */
export function scoreAccessibility(input: {
  geographicScope?:
    'national' | 'statewide' | 'regional' | 'single_county' | null;
  industryRestricted?: boolean;
  revenueRequirement?: boolean;
  licensingRequirement?: boolean;
  timeInBusinessRequirement?: boolean;
  ownerContributionPercent?: number | null;
}): number {
  let score = SCORE_MAXIMA.accessibility;

  switch (input.geographicScope) {
    case 'single_county':
      score -= 4;
      break;
    case 'regional':
      score -= 2;
      break;
    default:
      break;
  }

  if (input.industryRestricted) score -= 4;
  if (input.revenueRequirement) score -= 3;
  if (input.licensingRequirement) score -= 3;
  if (input.timeInBusinessRequirement) score -= 2;

  const contribution = input.ownerContributionPercent;
  if (typeof contribution === 'number' && contribution >= 20) score -= 2;

  return clamp(score, 0, SCORE_MAXIMA.accessibility);
}

/**
 * Time sensitivity (max 15). Higher when the deadline is close, when supply is
 * limited, or when awards are first-come, first-served.
 *
 * A record with no deadline scores 3, not 0: it is not urgent, but it is still
 * actionable, and zeroing the component would push otherwise strong evergreen
 * programs below their real usefulness.
 */
export function scoreTimeSensitivity(input: {
  closingDate?: Date | null;
  now?: Date;
  firstComeFirstServed?: boolean;
  limitedInventory?: boolean;
}): number {
  const now = input.now ?? new Date();
  const { closingDate } = input;

  let base: number;
  if (!closingDate) {
    base = 3;
  } else {
    const msRemaining = closingDate.getTime() - now.getTime();
    if (msRemaining < 0) {
      base = 0;
    } else {
      const daysRemaining = msRemaining / (24 * 60 * 60 * 1000);
      if (daysRemaining <= 3) base = 15;
      else if (daysRemaining <= 7) base = 13;
      else if (daysRemaining <= 14) base = 11;
      else if (daysRemaining <= 30) base = 8;
      else if (daysRemaining <= 60) base = 6;
      else if (daysRemaining <= 90) base = 4;
      else base = 2;
    }
  }

  // An expired deadline is not urgent, it is over — no bonuses apply.
  if (base === 0) return 0;

  if (input.firstComeFirstServed) base += 2;
  if (input.limitedInventory) base += 2;

  return clamp(base, 0, SCORE_MAXIMA.timeSensitivity);
}

export type SourceTier =
  | 'primary_government'
  | 'authorized_official'
  | 'licensed'
  | 'verified_secondary'
  | 'unverified_lead';

/** Source reliability (max 15). Values are fixed by spec section 12. */
export const SOURCE_TIER_SCORES: Readonly<Record<SourceTier, number>> = {
  primary_government: 15,
  authorized_official: 13,
  licensed: 11,
  verified_secondary: 8,
  unverified_lead: 3,
};

export function scoreSourceReliability(
  input: SourceTier | { reliabilityScore: number },
): number {
  if (typeof input === 'string') {
    return SOURCE_TIER_SCORES[input];
  }
  return clamp(input.reliabilityScore, 0, SCORE_MAXIMA.sourceReliability);
}

/**
 * Capital requirement (max 10). Lower required capital scores higher, because
 * the component measures how many subscribers could actually act.
 *
 * An unknown requirement scores 5 (neutral) rather than 0 — an unresearched
 * field should not be indistinguishable from a genuinely capital-heavy deal.
 */
export function scoreCapitalRequirement(input: {
  capitalRequiredMin?: number | null;
  depositRequired?: number | null;
}): number {
  const candidates = [input.capitalRequiredMin, input.depositRequired].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  );
  if (candidates.length === 0) return 5;

  const required = Math.min(...candidates);

  if (required <= 0) return 10;
  if (required <= 10_000) return 9;
  if (required <= 25_000) return 8;
  if (required <= 50_000) return 7;
  if (required <= 100_000) return 6;
  if (required <= 250_000) return 5;
  if (required <= 500_000) return 4;
  if (required <= 1_000_000) return 3;
  if (required <= 2_500_000) return 2;
  return 1;
}

export type ComplexityLevel = 'low' | 'moderate' | 'high' | 'very_high';

/** Complexity (max 10). Lower application burden scores higher. */
export function scoreComplexity(level: ComplexityLevel): number {
  const table: Record<ComplexityLevel, number> = {
    low: 10,
    moderate: 7,
    high: 4,
    very_high: 1,
  };
  return table[level];
}

export type RiskLevel = 'low' | 'moderate' | 'elevated' | 'high' | 'severe';

/** Risk (max 5). Lower risk scores higher. */
export function scoreRisk(level: RiskLevel): number {
  const table: Record<RiskLevel, number> = {
    low: 5,
    moderate: 3,
    elevated: 2,
    high: 1,
    severe: 0,
  };
  return table[level];
}

// ---------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------

const COMPONENT_LABELS: Readonly<Record<ScoreComponentKey, string>> = {
  financialValue: 'Financial value',
  accessibility: 'Accessibility',
  timeSensitivity: 'Time sensitivity',
  sourceReliability: 'Source reliability',
  capitalRequirement: 'Capital requirement',
  complexity: 'Complexity',
  risk: 'Risk',
};

export interface ScoreBreakdownRow {
  key: ScoreComponentKey;
  label: string;
  awarded: number;
  maximum: number;
  /** Share of the maximum, 0–1. Drives the bar widths on the detail page. */
  ratio: number;
}

export function scoreBreakdown(
  components: Partial<ScoreComponents>,
): ScoreBreakdownRow[] {
  const clamped = clampComponents(components);
  return (Object.keys(SCORE_MAXIMA) as ScoreComponentKey[]).map((key) => {
    const maximum: number = SCORE_MAXIMA[key];
    const awarded = clamped[key];
    return {
      key,
      label: COMPONENT_LABELS[key],
      awarded,
      maximum,
      ratio: awarded / maximum,
    };
  });
}

/**
 * A plain-language explanation of the score, shown to Detailed and Premium
 * members. Free and Weekly members see the total and classification only.
 */
export function explainScore(
  components: Partial<ScoreComponents>,
  options: { manualAdjustment?: number; adjustmentReason?: string | null } = {},
): string {
  const rows = scoreBreakdown(components);
  const calculated = calculateTotal(components);
  const adjustment = options.manualAdjustment ?? 0;
  const final = applyManualAdjustment(calculated, adjustment);

  const strongest = [...rows].sort((a, b) => b.ratio - a.ratio)[0];
  const weakest = [...rows].sort((a, b) => a.ratio - b.ratio)[0];

  const parts: string[] = [];
  parts.push(
    `Scored ${final} of ${MAX_SCORE} — ${classificationLabel(classifyScore(final))}.`,
  );

  if (strongest && weakest && strongest.key !== weakest.key) {
    parts.push(
      `The strongest contributor is ${strongest.label.toLowerCase()} ` +
        `(${strongest.awarded} of ${strongest.maximum}); the weakest is ` +
        `${weakest.label.toLowerCase()} (${weakest.awarded} of ${weakest.maximum}).`,
    );
  }

  if (adjustment !== 0) {
    const direction = adjustment > 0 ? 'raised' : 'lowered';
    const reason = options.adjustmentReason?.trim();
    parts.push(
      `A reviewer ${direction} the calculated score of ${calculated} by ` +
        `${Math.abs(adjustment)} point${Math.abs(adjustment) === 1 ? '' : 's'}` +
        (reason ? `: ${reason}` : '.'),
    );
  }

  return parts.join(' ');
}

export interface ScoreResult {
  components: ScoreComponents;
  calculatedTotal: number;
  manualAdjustment: number;
  finalTotal: number;
  classification: ScoreClassification;
  explanation: string;
  breakdown: ScoreBreakdownRow[];
}

/** Assembles the complete score record written by the admin editor. */
export function buildScore(
  components: Partial<ScoreComponents>,
  options: { manualAdjustment?: number; adjustmentReason?: string | null } = {},
): ScoreResult {
  const clamped = clampComponents(components);
  const calculatedTotal = calculateTotal(clamped);
  const manualAdjustment = clamp(
    options.manualAdjustment ?? 0,
    -MAX_MANUAL_ADJUSTMENT,
    MAX_MANUAL_ADJUSTMENT,
  );
  const finalTotal = applyManualAdjustment(calculatedTotal, manualAdjustment);

  return {
    components: clamped,
    calculatedTotal,
    manualAdjustment,
    finalTotal,
    classification: classifyScore(finalTotal),
    explanation: explainScore(clamped, {
      manualAdjustment,
      adjustmentReason: options.adjustmentReason ?? null,
    }),
    breakdown: scoreBreakdown(clamped),
  };
}
