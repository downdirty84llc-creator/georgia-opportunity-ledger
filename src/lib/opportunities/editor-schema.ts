import {
  FUNDING_TYPES,
  OPPORTUNITY_CATEGORIES,
  OPPORTUNITY_STATUSES,
  PROPERTY_TYPES,
  VERIFICATION_STATUSES,
} from '@/lib/search/filters';
import { SCORE_MAXIMA, type ScoreComponentKey } from '@/lib/scoring/score';

/**
 * The seven-step opportunity editor (spec 15.2).
 *
 * Step definitions live here rather than inside the component so that the
 * completeness checks, the publish gate and the step navigation all read from
 * one description of what each step is for. Adding a field means adding it in
 * one place.
 */

export interface EditorStep {
  id: string;
  title: string;
  purpose: string;
  /** Fields whose absence should mark the step incomplete. */
  requiredFields: readonly string[];
}

export const EDITOR_STEPS: readonly EditorStep[] = [
  {
    id: 'classification',
    title: 'Classification',
    purpose:
      'What this is, where it is, and who should be able to see it. Everything downstream keys off these.',
    requiredFields: ['title', 'category', 'subtype'],
  },
  {
    id: 'source',
    title: 'Source',
    purpose:
      'Where it came from and when it was verified. A record without traceable provenance cannot be published.',
    requiredFields: ['sourceId', 'originalSourceUrl', 'dateVerified'],
  },
  {
    id: 'financial',
    title: 'Financial',
    purpose:
      'What it is worth and what it costs to pursue. Ranges are fine; guesses presented as precision are not.',
    requiredFields: [],
  },
  {
    id: 'details',
    title: 'Details',
    purpose:
      'The category-specific fields — property particulars or programme rules.',
    requiredFields: [],
  },
  {
    id: 'analysis',
    title: 'Analysis',
    purpose:
      'The part a subscriber is paying for: what it means, what could go wrong, and what to do next.',
    requiredFields: ['summary', 'riskSummary', 'recommendedNextAction'],
  },
  {
    id: 'scoring',
    title: 'Scoring',
    purpose:
      'Seven weighted components. A manual adjustment is allowed but must be justified in writing.',
    requiredFields: [],
  },
  {
    id: 'publication',
    title: 'Publication',
    purpose:
      'Preview it as each tier sees it, then submit for review or publish.',
    requiredFields: [],
  },
];

/** Which step a given required field belongs to, for the publish gate. */
export function stepForField(field: string): EditorStep | undefined {
  return EDITOR_STEPS.find((step) => step.requiredFields.includes(field));
}

export interface EditorDraft {
  // Step 1 — classification
  title: string;
  category: (typeof OPPORTUNITY_CATEGORIES)[number];
  subtype: string;
  stateId: string;
  countyId: string;
  cityId: string;
  industryId: string;
  streetAddress: string;
  minimumAccessRank: number;
  status: (typeof OPPORTUNITY_STATUSES)[number];

  // Step 2 — source
  sourceId: string;
  originalSourceUrl: string;
  dateDiscovered: string;
  dateVerified: string;
  verificationStatus: (typeof VERIFICATION_STATUSES)[number];

  // Step 3 — financial
  estimatedValueMin: string;
  estimatedValueMax: string;
  capitalRequiredMin: string;
  capitalRequiredMax: string;
  depositRequired: string;
  openingDate: string;
  closingDate: string;

  // Step 4 — category details
  propertyType: (typeof PROPERTY_TYPES)[number];
  saleType: string;
  parcelNumber: string;
  askingPrice: string;
  startingBid: string;
  buildingSizeSqft: string;
  lotSizeAcres: string;
  zoning: string;
  knownLiens: string;
  fundingType: (typeof FUNDING_TYPES)[number];
  fundingOrganization: string;
  minimumAmount: string;
  maximumAmount: string;
  ownerContributionPercent: string;
  applicationComplexity: 'low' | 'moderate' | 'high' | 'very_high';
  applicationUrl: string;

  // Step 5 — analysis
  summary: string;
  fullAnalysis: string;
  eligibilitySummary: string;
  restrictions: string;
  riskSummary: string;
  recommendedNextAction: string;
  requiredDocuments: string;

  // Step 6 — scoring
  score: Record<ScoreComponentKey, number>;
  manualAdjustment: number;
  adjustmentReason: string;

  // Step 7 — publication
  isFeatured: boolean;
  scheduledAt: string;
  internalNotes: string;
}

export function emptyDraft(): EditorDraft {
  const today = new Date().toISOString().slice(0, 10);
  return {
    title: '',
    category: 'commercial_property',
    subtype: '',
    stateId: '',
    countyId: '',
    cityId: '',
    industryId: '',
    streetAddress: '',
    minimumAccessRank: 20,
    status: 'open',

    sourceId: '',
    originalSourceUrl: '',
    dateDiscovered: today,
    dateVerified: today,
    verificationStatus: 'pending',

    estimatedValueMin: '',
    estimatedValueMax: '',
    capitalRequiredMin: '',
    capitalRequiredMax: '',
    depositRequired: '',
    openingDate: '',
    closingDate: '',

    propertyType: 'industrial',
    saleType: 'standard_listing',
    parcelNumber: '',
    askingPrice: '',
    startingBid: '',
    buildingSizeSqft: '',
    lotSizeAcres: '',
    zoning: '',
    knownLiens: '',
    fundingType: 'grant',
    fundingOrganization: '',
    minimumAmount: '',
    maximumAmount: '',
    ownerContributionPercent: '',
    applicationComplexity: 'moderate',
    applicationUrl: '',

    summary: '',
    fullAnalysis: '',
    eligibilitySummary: '',
    restrictions: '',
    riskSummary: '',
    recommendedNextAction: '',
    requiredDocuments: '',

    score: {
      financialValue: 0,
      accessibility: 0,
      timeSensitivity: 0,
      sourceReliability: 0,
      capitalRequirement: 0,
      complexity: 0,
      risk: 0,
    },
    manualAdjustment: 0,
    adjustmentReason: '',

    isFeatured: false,
    scheduledAt: '',
    internalNotes: '',
  };
}

/**
 * Which required fields are still empty, per step. Drives both the step
 * indicators and the "not ready to publish" list.
 */
export function incompleteFields(draft: EditorDraft): string[] {
  const missing: string[] = [];
  for (const step of EDITOR_STEPS) {
    for (const field of step.requiredFields) {
      const value = (draft as unknown as Record<string, unknown>)[field];
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && value.trim().length === 0)
      ) {
        missing.push(field);
      }
    }
  }
  return missing;
}

export function stepIsComplete(draft: EditorDraft, step: EditorStep): boolean {
  return step.requiredFields.every((field) => {
    const value = (draft as unknown as Record<string, unknown>)[field];
    return typeof value === 'string' ? value.trim().length > 0 : value != null;
  });
}

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: 'Title',
  category: 'Category',
  subtype: 'Subtype',
  sourceId: 'Primary source',
  originalSourceUrl: 'Source URL',
  dateVerified: 'Verification date',
  summary: 'Executive summary',
  riskSummary: 'Risk factors',
  recommendedNextAction: 'Recommended next action',
};

/** Component maxima, ordered for the scoring step. */
export const SCORE_FIELDS: ReadonlyArray<{
  key: ScoreComponentKey;
  label: string;
  max: number;
  hint: string;
}> = [
  {
    key: 'financialValue',
    label: 'Financial value',
    max: SCORE_MAXIMA.financialValue,
    hint: 'Direct value, savings, funding amount or acquisition discount.',
  },
  {
    key: 'accessibility',
    label: 'Accessibility',
    max: SCORE_MAXIMA.accessibility,
    hint: 'How many subscribers could realistically qualify.',
  },
  {
    key: 'timeSensitivity',
    label: 'Time sensitivity',
    max: SCORE_MAXIMA.timeSensitivity,
    hint: 'Deadline proximity, limited inventory, first-come awards.',
  },
  {
    key: 'sourceReliability',
    label: 'Source reliability',
    max: SCORE_MAXIMA.sourceReliability,
    hint: 'Primary government 15, authorised official 13, licensed 11, verified secondary 8.',
  },
  {
    key: 'capitalRequirement',
    label: 'Capital requirement',
    max: SCORE_MAXIMA.capitalRequirement,
    hint: 'Lower required capital scores higher. Unknown is 5, not 0.',
  },
  {
    key: 'complexity',
    label: 'Complexity',
    max: SCORE_MAXIMA.complexity,
    hint: 'Lower application or acquisition burden scores higher.',
  },
  {
    key: 'risk',
    label: 'Risk',
    max: SCORE_MAXIMA.risk,
    hint: 'Title risk, redemption periods, clawback terms, programme uncertainty.',
  },
];
