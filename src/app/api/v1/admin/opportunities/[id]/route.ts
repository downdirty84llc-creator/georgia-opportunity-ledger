import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  apiError,
  ok,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';
import { roleMayPerform } from '@/lib/opportunities/workflow';
import { buildScore } from '@/lib/scoring/score';
import {
  FUNDING_TYPES,
  OPPORTUNITY_CATEGORIES,
  OPPORTUNITY_STATUSES,
  PROPERTY_TYPES,
  VERIFICATION_STATUSES,
} from '@/lib/search/filters';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

const scoreSchema = z.object({
  financialValue: z.number().int().min(0).max(25),
  accessibility: z.number().int().min(0).max(20),
  timeSensitivity: z.number().int().min(0).max(15),
  sourceReliability: z.number().int().min(0).max(15),
  capitalRequirement: z.number().int().min(0).max(10),
  complexity: z.number().int().min(0).max(10),
  risk: z.number().int().min(0).max(5),
  manualAdjustment: z.number().int().min(-25).max(25).default(0),
  adjustmentReason: z.string().trim().max(1000).optional(),
});

const patchSchema = z.object({
  title: z.string().trim().min(4).max(240).optional(),
  category: z.enum(OPPORTUNITY_CATEGORIES).optional(),
  subtype: z.string().trim().min(2).max(80).optional(),
  summary: z.string().trim().min(20).max(4000).optional(),
  fullAnalysis: z.unknown().optional(),
  status: z.enum(OPPORTUNITY_STATUSES).optional(),
  stateId: z.string().uuid().nullable().optional(),
  countyId: z.string().uuid().nullable().optional(),
  cityId: z.string().uuid().nullable().optional(),
  industryId: z.string().uuid().nullable().optional(),
  streetAddress: z.string().trim().max(240).nullable().optional(),
  sourceId: z.string().uuid().optional(),
  originalSourceUrl: z.string().url().max(2000).optional(),
  dateVerified: z.coerce.date().optional(),
  openingDate: z.coerce.date().nullable().optional(),
  closingDate: z.coerce.date().nullable().optional(),
  estimatedValueMin: z.number().nonnegative().nullable().optional(),
  estimatedValueMax: z.number().nonnegative().nullable().optional(),
  capitalRequiredMin: z.number().nonnegative().nullable().optional(),
  capitalRequiredMax: z.number().nonnegative().nullable().optional(),
  depositRequired: z.number().nonnegative().nullable().optional(),
  eligibilitySummary: z.string().trim().max(8000).nullable().optional(),
  requiredDocuments: z.array(z.string().max(240)).max(50).optional(),
  restrictions: z.string().trim().max(8000).nullable().optional(),
  riskSummary: z.string().trim().max(8000).optional(),
  recommendedNextAction: z.string().trim().max(4000).optional(),
  verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
  minimumAccessRank: z.number().int().min(0).max(100).optional(),
  isFeatured: z.boolean().optional(),
  isRestricted: z.boolean().optional(),
  restrictionReason: z.string().trim().max(1000).nullable().optional(),
  internalNotes: z.string().trim().max(8000).nullable().optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
  score: scoreSchema.optional(),
  propertyDetails: z
    .object({
      propertyType: z.enum(PROPERTY_TYPES),
      saleType: z.enum([
        'standard_listing',
        'auction',
        'tax_sale',
        'sheriff_sale',
        'foreclosure',
        'bank_owned',
        'government_sale',
        'development_authority',
        'distressed_sale',
        'off_market_indication',
      ]),
      askingPrice: z.number().nonnegative().nullable().optional(),
      startingBid: z.number().nonnegative().nullable().optional(),
      buildingSizeSqft: z.number().nonnegative().nullable().optional(),
      lotSizeAcres: z.number().nonnegative().nullable().optional(),
      zoning: z.string().trim().max(120).nullable().optional(),
      auctionDate: z.coerce.date().nullable().optional(),
      knownLiens: z.string().trim().max(4000).nullable().optional(),
    })
    .optional(),
  fundingDetails: z
    .object({
      fundingType: z.enum(FUNDING_TYPES),
      fundingOrganization: z.string().trim().max(240).nullable().optional(),
      minimumAmount: z.number().nonnegative().nullable().optional(),
      maximumAmount: z.number().nonnegative().nullable().optional(),
      applicationComplexity: z
        .enum(['low', 'moderate', 'high', 'very_high'])
        .optional(),
      applicationUrl: z.string().url().max(2000).nullable().optional(),
      applicationDeadline: z.coerce.date().nullable().optional(),
    })
    .optional(),
});

const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  category: 'category',
  subtype: 'subtype',
  summary: 'summary',
  fullAnalysis: 'full_analysis',
  status: 'status',
  stateId: 'state_id',
  countyId: 'county_id',
  cityId: 'city_id',
  industryId: 'industry_id',
  streetAddress: 'street_address',
  sourceId: 'source_id',
  originalSourceUrl: 'original_source_url',
  estimatedValueMin: 'estimated_value_min',
  estimatedValueMax: 'estimated_value_max',
  capitalRequiredMin: 'capital_required_min',
  capitalRequiredMax: 'capital_required_max',
  depositRequired: 'deposit_required',
  eligibilitySummary: 'eligibility_summary',
  requiredDocuments: 'required_documents',
  restrictions: 'restrictions',
  riskSummary: 'risk_summary',
  recommendedNextAction: 'recommended_next_action',
  verificationStatus: 'verification_status',
  minimumAccessRank: 'minimum_access_rank',
  isFeatured: 'is_featured',
  isRestricted: 'is_restricted',
  restrictionReason: 'restriction_reason',
  internalNotes: 'internal_notes',
};

/**
 * PATCH /api/v1/admin/opportunities/{id}
 *
 * Edits content. Workflow moves live on the dedicated action endpoints, and
 * `workflow_status` is deliberately not accepted here — otherwise a researcher
 * could publish by PATCHing a field they are allowed to edit.
 */
export const PATCH = withErrorHandling(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (request: Request, context: any): Promise<NextResponse> => {
    const { id } = await (context as RouteContext).params;
    const viewer = await getViewer();

    if (
      !viewer.isAuthenticated ||
      viewer.accountStatus !== 'active' ||
      !roleMayPerform(viewer.role, 'edit')
    ) {
      return apiError('forbidden', 'You cannot edit opportunity records.');
    }

    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);
    const body = parsed.data;

    // Changing who can see a record is an access decision, not a content edit.
    if (
      (body.minimumAccessRank !== undefined || body.isRestricted !== undefined) &&
      !roleMayPerform(viewer.role, 'approve')
    ) {
      return apiError(
        'forbidden',
        'Only a reviewer or editor can change who may see a record.',
      );
    }

    const update: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMN_MAP)) {
      const value = (body as Record<string, unknown>)[key];
      if (value !== undefined) update[column] = value;
    }
    if (body.dateVerified) {
      update.date_verified = body.dateVerified.toISOString().slice(0, 10);
      update.last_reviewed_at = new Date().toISOString();
    }
    if (body.openingDate !== undefined) {
      update.opening_date = body.openingDate?.toISOString() ?? null;
    }
    if (body.closingDate !== undefined) {
      update.closing_date = body.closingDate?.toISOString() ?? null;
    }
    if (body.scheduledAt !== undefined) {
      update.scheduled_at = body.scheduledAt?.toISOString() ?? null;
    }

    const supabase = await createServerSupabaseClient();

    if (body.score) {
      // Only a reviewer or above may move a score (spec 5, "Reviewer").
      if (!roleMayPerform(viewer.role, 'approve')) {
        return apiError('forbidden', 'Only a reviewer or editor can change a score.');
      }
      if (body.score.manualAdjustment !== 0 && !body.score.adjustmentReason) {
        return apiError(
          'validation_failed',
          'A manual score adjustment needs a written reason.',
        );
      }

      const result = buildScore(body.score, {
        manualAdjustment: body.score.manualAdjustment,
        adjustmentReason: body.score.adjustmentReason ?? null,
      });

      update.score = result.finalTotal;
      update.score_classification = result.classification;
      update.score_explanation = result.explanation;

      const { error: scoreError } = await supabase
        .from('opportunity_score_components')
        .upsert(
          {
            opportunity_id: id,
            financial_value_score: result.components.financialValue,
            accessibility_score: result.components.accessibility,
            time_sensitivity_score: result.components.timeSensitivity,
            source_reliability_score: result.components.sourceReliability,
            capital_requirement_score: result.components.capitalRequirement,
            complexity_score: result.components.complexity,
            risk_score: result.components.risk,
            calculated_total: result.calculatedTotal,
            manual_adjustment: result.manualAdjustment,
            final_total: result.finalTotal,
            adjustment_reason: body.score.adjustmentReason ?? null,
            adjusted_by: result.manualAdjustment !== 0 ? viewer.userId : null,
            adjusted_at:
              result.manualAdjustment !== 0 ? new Date().toISOString() : null,
          },
          { onConflict: 'opportunity_id' },
        );
      if (scoreError) throw new Error(scoreError.message);
    }

    if (Object.keys(update).length > 0) {
      const { error } = await supabase
        .from('opportunities')
        .update(update)
        .eq('id', id);
      if (error) throw new Error(error.message);
    }

    if (body.propertyDetails) {
      const details = body.propertyDetails;
      const { error } = await supabase.from('property_details').upsert(
        {
          opportunity_id: id,
          property_type: details.propertyType,
          sale_type: details.saleType,
          asking_price: details.askingPrice ?? null,
          starting_bid: details.startingBid ?? null,
          building_size_sqft: details.buildingSizeSqft ?? null,
          lot_size_acres: details.lotSizeAcres ?? null,
          zoning: details.zoning ?? null,
          auction_date: details.auctionDate?.toISOString() ?? null,
          known_liens: details.knownLiens ?? null,
        },
        { onConflict: 'opportunity_id' },
      );
      if (error) throw new Error(error.message);
    }

    if (body.fundingDetails) {
      const details = body.fundingDetails;
      const { error } = await supabase.from('funding_details').upsert(
        {
          opportunity_id: id,
          funding_type: details.fundingType,
          funding_organization: details.fundingOrganization ?? null,
          minimum_amount: details.minimumAmount ?? null,
          maximum_amount: details.maximumAmount ?? null,
          application_complexity: details.applicationComplexity ?? 'moderate',
          application_url: details.applicationUrl ?? null,
          application_deadline:
            details.applicationDeadline?.toISOString() ?? null,
        },
        { onConflict: 'opportunity_id' },
      );
      if (error) throw new Error(error.message);
    }

    const { data, error: reloadError } = await supabase
      .from('opportunities')
      .select(
        'id, slug, title, workflow_status, status, score, score_classification, updated_at',
      )
      .eq('id', id)
      .maybeSingle();

    if (reloadError) throw new Error(reloadError.message);
    if (!data) return apiError('not_found', 'Record not found.');

    return ok(data);
  },
);
