import { emptyDraft, type EditorDraft } from '@/lib/opportunities/editor-schema';

type Row = Record<string, unknown>;

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function numberText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function dateInput(value: unknown): string {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function dateTimeInput(value: unknown): string {
  if (!value) return '';
  // `datetime-local` wants `YYYY-MM-DDTHH:mm` with no zone.
  return String(value).slice(0, 16);
}

function relation(row: Row, key: string): Row | null {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] as Row) ?? null;
  return (value as Row) ?? null;
}

/**
 * Turns a stored opportunity into the flat, all-strings shape the editor form
 * binds to. Keeping the conversion here means the form never has to reason
 * about nulls, numbers-as-strings or date formats.
 */
export function draftFromRecord(record: Row): EditorDraft {
  const base = emptyDraft();
  const property = relation(record, 'property_details');
  const funding = relation(record, 'funding_details');
  const components = relation(record, 'opportunity_score_components');

  const documents = Array.isArray(record.required_documents)
    ? (record.required_documents as unknown[]).map(String).join('\n')
    : '';

  const analysis =
    typeof record.full_analysis === 'string'
      ? record.full_analysis
      : record.full_analysis
        ? JSON.stringify(record.full_analysis, null, 2)
        : '';

  return {
    ...base,

    title: text(record.title),
    category: (record.category as EditorDraft['category']) ?? base.category,
    subtype: text(record.subtype),
    stateId: text(record.state_id),
    countyId: text(record.county_id),
    cityId: text(record.city_id),
    industryId: text(record.industry_id),
    streetAddress: text(record.street_address),
    minimumAccessRank: Number(record.minimum_access_rank ?? base.minimumAccessRank),
    status: (record.status as EditorDraft['status']) ?? base.status,

    sourceId: text(record.source_id),
    originalSourceUrl: text(record.original_source_url),
    dateDiscovered: dateInput(record.date_discovered) || base.dateDiscovered,
    dateVerified: dateInput(record.date_verified) || base.dateVerified,
    verificationStatus:
      (record.verification_status as EditorDraft['verificationStatus']) ??
      base.verificationStatus,

    estimatedValueMin: numberText(record.estimated_value_min),
    estimatedValueMax: numberText(record.estimated_value_max),
    capitalRequiredMin: numberText(record.capital_required_min),
    capitalRequiredMax: numberText(record.capital_required_max),
    depositRequired: numberText(record.deposit_required),
    openingDate: dateTimeInput(record.opening_date),
    closingDate: dateTimeInput(record.closing_date),

    propertyType:
      (property?.property_type as EditorDraft['propertyType']) ??
      base.propertyType,
    saleType: text(property?.sale_type) || base.saleType,
    parcelNumber: text(property?.parcel_number),
    askingPrice: numberText(property?.asking_price),
    startingBid: numberText(property?.starting_bid),
    buildingSizeSqft: numberText(property?.building_size_sqft),
    lotSizeAcres: numberText(property?.lot_size_acres),
    zoning: text(property?.zoning),
    knownLiens: text(property?.known_liens),

    fundingType:
      (funding?.funding_type as EditorDraft['fundingType']) ?? base.fundingType,
    fundingOrganization: text(funding?.funding_organization),
    minimumAmount: numberText(funding?.minimum_amount),
    maximumAmount: numberText(funding?.maximum_amount),
    ownerContributionPercent: numberText(funding?.owner_contribution_percent),
    applicationComplexity:
      (funding?.application_complexity as EditorDraft['applicationComplexity']) ??
      base.applicationComplexity,
    applicationUrl: text(funding?.application_url),

    summary: text(record.summary),
    fullAnalysis: analysis,
    eligibilitySummary: text(record.eligibility_summary),
    restrictions: text(record.restrictions),
    riskSummary: text(record.risk_summary),
    recommendedNextAction: text(record.recommended_next_action),
    requiredDocuments: documents,

    score: {
      financialValue: Number(components?.financial_value_score ?? 0),
      accessibility: Number(components?.accessibility_score ?? 0),
      timeSensitivity: Number(components?.time_sensitivity_score ?? 0),
      sourceReliability: Number(components?.source_reliability_score ?? 0),
      capitalRequirement: Number(components?.capital_requirement_score ?? 0),
      complexity: Number(components?.complexity_score ?? 0),
      risk: Number(components?.risk_score ?? 0),
    },
    manualAdjustment: Number(components?.manual_adjustment ?? 0),
    adjustmentReason: text(components?.adjustment_reason),

    isFeatured: Boolean(record.is_featured),
    scheduledAt: dateTimeInput(record.scheduled_at),
    internalNotes: text(record.internal_notes),
  };
}
