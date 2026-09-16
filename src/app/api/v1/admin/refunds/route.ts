import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { getViewer } from '@/lib/auth/session';
import { stripe } from '@/lib/billing/stripe';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  checkRateLimit,
  rateLimitHeaders,
  rateLimitIdentity,
} from '@/lib/http/rate-limit';
import {
  apiError,
  created,
  rateLimited,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/admin/refunds
 *
 * The Refund Policy says refunds are "approved by a billing manager and every
 * refund action is recorded in the audit log". Issuing them from the Stripe
 * dashboard satisfied neither half — no role check, no entry — so the control
 * the policy describes now exists here.
 *
 * Role, not rank. A Premium member has rank 30 and cannot reach this; a
 * billing manager has no paid plan and can. Refunding is an administrative
 * permission, and administrative permissions are always role checks.
 */
const refundSchema = z.object({
  paymentIntentId: z.string().trim().min(1).max(120),
  /** Minor units. Omit to refund the payment in full. */
  amount: z.number().int().positive().max(100_000_00).optional(),
  reason: z.enum(['duplicate', 'fraudulent', 'requested_by_customer']),
  /** Free text for the audit entry — why this was approved. */
  note: z.string().trim().min(3).max(500),
});

export const POST = withErrorHandling(
  async (request: Request): Promise<NextResponse> => {
    const viewer = await getViewer();

    if (
      !viewer.isAuthenticated ||
      viewer.accountStatus !== 'active' ||
      !['billing_manager', 'super_administrator'].includes(viewer.role)
    ) {
      return apiError(
        'forbidden',
        'Only a billing manager may issue a refund.',
      );
    }

    const parsed = refundSchema.safeParse(await request.json());
    if (!parsed.success) return validationFailed(parsed.error);

    const limit = await checkRateLimit(
      'refund',
      rateLimitIdentity(request, viewer.userId),
    );
    if (!limit.allowed) return rateLimited(limit.resetAt);

    const { paymentIntentId, amount, reason, note } = parsed.data;

    let refundId: string;
    let refunded: number;
    let currency: string;

    try {
      const refund = await stripe().refunds.create({
        payment_intent: paymentIntentId,
        ...(amount ? { amount } : {}),
        reason,
        metadata: {
          approved_by: viewer.userId ?? 'unknown',
          note: note.slice(0, 200),
        },
      });
      refundId = refund.id;
      refunded = refund.amount;
      currency = refund.currency;
    } catch (error) {
      // Stripe rejects a double refund itself, which is the guard that matters
      // — it owns the money and we do not. Its message is safe to surface: it
      // describes the caller's own request, not our internals.
      return apiError(
        'conflict',
        error instanceof Error ? error.message : 'Stripe refused the refund.',
        { paymentIntentId },
      );
    }

    // Written after Stripe confirms, so the trail never claims a refund that
    // did not happen. The reverse ordering would be worse: an audit entry for
    // money that was never returned.
    const supabase = await createServerSupabaseClient();
    const { error: auditError } = await supabase.rpc('log_admin_action', {
      p_action: 'billing.refunded',
      p_entity_type: 'payment_intent',
      p_entity_id: null,
      p_previous: null,
      p_new: {
        paymentIntentId,
        refundId,
        amount: refunded,
        currency,
        reason,
        note,
      },
    });

    if (auditError) {
      // The money is already back with the customer, so this is not a failure
      // to report as one — but an unlogged refund is exactly what the policy
      // promises cannot happen, so it must be loud.
      console.error('[refunds] refund issued but audit entry failed', {
        refundId,
        error: auditError.message,
      });
    }

    return created(
      {
        refundId,
        paymentIntentId,
        amount: refunded,
        currency,
        reason,
        audited: !auditError,
      },
      { headers: rateLimitHeaders(limit) },
    );
  },
);
