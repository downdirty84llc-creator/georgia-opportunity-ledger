import type { AlertCandidate } from '@/lib/alerts/matching';

export interface CandidateRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  score: number;
  category: string;
  status: string;
  subtype?: string | null;
  is_featured?: boolean;
  is_closing_soon?: boolean;
  updated_at?: string;
  county_id: string | null;
  city_id: string | null;
  state_id: string | null;
  industry_id: string | null;
  capital_required_min: number | null;
  estimated_value_max: number | null;
  minimum_access_rank: number;
  closing_date: string | null;
  is_expired: boolean;
  verification_status: string;
  published_at: string | null;
  is_restricted: boolean;
  workflow_status: string;
  recommended_next_action: string;
  counties: { name?: string; slug?: string } | null;
  opportunity_industries?: { industry_id: string }[];
  property_details?: { property_type: string } | null;
  funding_details?: { funding_type: string } | null;
}

export function toCandidate(
  row: CandidateRow,
  versionNumber: number,
): AlertCandidate {
  return {
    opportunityId: row.id,
    versionNumber,
    score: row.score,
    category: row.category,
    status: row.status,
    subtype: row.subtype,
    countySlug: row.counties?.slug,
    isFeatured: row.is_featured,
    isClosingSoon: row.is_closing_soon,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
    countyId: row.county_id,
    cityId: row.city_id,
    stateId: row.state_id,
    industryIds: [
      ...(row.industry_id ? [row.industry_id] : []),
      ...(row.opportunity_industries ?? []).map((item) => item.industry_id),
    ],
    propertyType: row.property_details?.property_type ?? null,
    fundingType: row.funding_details?.funding_type ?? null,
    capitalRequiredMin: row.capital_required_min,
    estimatedValueMax: row.estimated_value_max,
    minimumAccessRank: row.minimum_access_rank,
    closingDate: row.closing_date ? new Date(row.closing_date) : null,
    isExpired: row.is_expired,
    verificationStatus: row.verification_status,
    publishedAt: row.published_at ? new Date(row.published_at) : null,
    isRestricted: row.is_restricted,
    workflowStatus: row.workflow_status,
  };
}

export const EMAIL_CANDIDATE_SELECT = `id,slug,title,summary,score,category,status,subtype,is_featured,is_closing_soon,updated_at,county_id,city_id,
state_id,industry_id,capital_required_min,estimated_value_max,minimum_access_rank,closing_date,is_expired,
verification_status,published_at,is_restricted,workflow_status,recommended_next_action,counties(name,slug),
opportunity_industries(industry_id),property_details(property_type),funding_details(funding_type)`;
