import {
  decideOpportunityView,
  type OpportunityViewDecision,
  type Viewer,
} from '@/lib/access/entitlements';
import { scoreBreakdown } from '@/lib/scoring/score';

/**
 * Tier-aware serialisation of an opportunity.
 *
 * The redaction happens once, here, and both the API route and the server
 * component render from the result. Two copies of "which fields does a Weekly
 * member see" is how a product like this leaks paid content, so there is only
 * one.
 */

type Row = Record<string, unknown>;

function pick<T>(row: Row, key: string): T | null {
  const value = row[key];
  return (value ?? null) as T | null;
}

function relation(row: Row, key: string): Row | null {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] as Row) ?? null;
  return (value as Row) ?? null;
}

export interface SerializedOpportunity {
  id: string;
  slug: string;
  title: string;
  category: string;
  subtype: string;
  status: string;
  teaser: string;
  score: number;
  classification: string;
  county: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  closingDate: string | null;
  openingDate: string | null;
  isClosingSoon: boolean;
  isExpired: boolean;
  isFeatured: boolean;
  isSample: boolean;
  dateVerified: string | null;
  lastReviewedAt: string | null;
  verificationStatus: string;
  minimumAccessRank: number;

  /** Present from the Weekly tier upward. */
  summary?: string;
  estimatedValueMin?: number | null;
  estimatedValueMax?: number | null;
  capitalRequiredMin?: number | null;
  capitalRequiredMax?: number | null;
  depositRequired?: number | null;
  source?: {
    name: string | null;
    organization: string | null;
    url: string;
    reliabilityScore: number | null;
  };

  /** Present from the Detailed tier upward. */
  fullAnalysis?: unknown;
  eligibilitySummary?: string | null;
  restrictions?: string | null;
  riskSummary?: string;
  recommendedNextAction?: string;
  requiredDocuments?: unknown;
  scoreExplanation?: string;
  scoreBreakdown?: ReturnType<typeof scoreBreakdown>;
  propertyDetails?: Row | null;
  fundingDetails?: Row | null;
  supportingSources?: Row[];

  /** Always present: what is hidden and how to unlock it. */
  access: {
    detailLevel: OpportunityViewDecision['detailLevel'];
    canViewFull: boolean;
    lockedSections: string[];
    upgradeMessage: string;
    requiredPlan?: string;
    reason: string;
  };
}

export function serializeOpportunity(
  row: Row,
  viewer: Viewer,
): SerializedOpportunity {
  const decision = decideOpportunityView(viewer, {
    workflowStatus: String(row.workflow_status ?? ''),
    isRestricted: Boolean(row.is_restricted),
    minimumAccessRank: Number(row.minimum_access_rank ?? 0),
  });

  const county = relation(row, 'counties');
  const city = relation(row, 'cities');
  const state = relation(row, 'states');
  const industry = relation(row, 'industries');

  const summary = String(row.summary ?? '');
  const teaser =
    summary.length <= 180 ? summary : `${summary.slice(0, 177)}...`;

  const base: SerializedOpportunity = {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    category: String(row.category),
    subtype: String(row.subtype ?? ''),
    status: String(row.status),
    teaser,
    score: Number(row.score ?? 0),
    classification: String(row.score_classification ?? 'information_only'),
    county: county ? String(county.name) : null,
    city: city ? String(city.name) : null,
    state: state ? String(state.abbreviation) : null,
    industry: industry ? String(industry.name) : null,
    closingDate: pick<string>(row, 'closing_date'),
    openingDate: pick<string>(row, 'opening_date'),
    isClosingSoon: Boolean(row.is_closing_soon),
    isExpired: Boolean(row.is_expired),
    isFeatured: Boolean(row.is_featured),
    isSample: Boolean(row.is_sample),
    dateVerified: pick<string>(row, 'date_verified'),
    lastReviewedAt: pick<string>(row, 'last_reviewed_at'),
    verificationStatus: String(row.verification_status ?? 'unverified'),
    minimumAccessRank: Number(row.minimum_access_rank ?? 0),
    access: {
      detailLevel: decision.detailLevel,
      canViewFull: decision.canViewFull,
      lockedSections: decision.lockedSections,
      upgradeMessage: decision.decision.message,
      requiredPlan: decision.decision.requiredPlan,
      reason: decision.decision.reason,
    },
  };

  if (decision.detailLevel === 'preview') return base;

  // --- Weekly tier and above -------------------------------------------------
  const sourceRelation = relation(row, 'sources');
  base.summary = summary;
  base.estimatedValueMin = pick<number>(row, 'estimated_value_min');
  base.estimatedValueMax = pick<number>(row, 'estimated_value_max');
  base.capitalRequiredMin = pick<number>(row, 'capital_required_min');
  base.capitalRequiredMax = pick<number>(row, 'capital_required_max');
  base.depositRequired = pick<number>(row, 'deposit_required');
  base.source = {
    name: sourceRelation ? String(sourceRelation.name) : null,
    organization: sourceRelation
      ? ((sourceRelation.organization_name as string | null) ?? null)
      : null,
    url: String(row.original_source_url ?? ''),
    reliabilityScore: sourceRelation
      ? Number(sourceRelation.reliability_score ?? 0)
      : null,
  };

  if (decision.detailLevel !== 'complete') return base;

  // --- Detailed tier and above ----------------------------------------------
  const components = relation(row, 'opportunity_score_components');

  base.fullAnalysis = row.full_analysis ?? null;
  base.eligibilitySummary = pick<string>(row, 'eligibility_summary');
  base.restrictions = pick<string>(row, 'restrictions');
  base.riskSummary = String(row.risk_summary ?? '');
  base.recommendedNextAction = String(row.recommended_next_action ?? '');
  base.requiredDocuments = row.required_documents ?? [];
  base.scoreExplanation = String(row.score_explanation ?? '');
  base.propertyDetails = relation(row, 'property_details');
  base.fundingDetails = relation(row, 'funding_details');
  base.supportingSources = Array.isArray(row.opportunity_sources)
    ? (row.opportunity_sources as Row[])
    : [];

  if (components) {
    base.scoreBreakdown = scoreBreakdown({
      financialValue: Number(components.financial_value_score ?? 0),
      accessibility: Number(components.accessibility_score ?? 0),
      timeSensitivity: Number(components.time_sensitivity_score ?? 0),
      sourceReliability: Number(components.source_reliability_score ?? 0),
      capitalRequirement: Number(components.capital_requirement_score ?? 0),
      complexity: Number(components.complexity_score ?? 0),
      risk: Number(components.risk_score ?? 0),
    });
  }

  return base;
}
