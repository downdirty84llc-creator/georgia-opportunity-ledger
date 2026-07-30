import { cache } from 'react';

import {
  ANONYMOUS_VIEWER,
  buildViewer,
  type Viewer,
} from '@/lib/access/entitlements';
import { parsePlanFeatures, type PlanCode } from '@/lib/access/ranks';
import type {
  AccountStatus,
  SubscriptionRecord,
  SubscriptionStatus,
  UserRole,
} from '@/lib/billing/subscription';
import { createServerSupabaseClient } from '@/lib/db/server';

export interface SessionContext {
  viewer: Viewer;
  subscription: SubscriptionRecord | null;
  planCode: PlanCode;
  planName: string;
  subscriptionStatus: SubscriptionStatus | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  profile: {
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    companyName: string | null;
    onboardingComplete: boolean;
  } | null;
}

const ANONYMOUS_SESSION: SessionContext = {
  viewer: ANONYMOUS_VIEWER,
  subscription: null,
  planCode: 'free',
  planName: 'Free Preview',
  subscriptionStatus: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  profile: null,
};

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

/**
 * Resolves the caller's identity, plan and entitlements.
 *
 * Wrapped in React's `cache` so a page that checks entitlements in the layout,
 * again in the page, and again in three components still issues one round trip
 * per request.
 *
 * Uses `getUser()` rather than `getSession()`: `getSession()` trusts the cookie
 * as-is, while `getUser()` validates the token with the auth server. On a page
 * that decides what paid content to render, that difference matters.
 */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) return ANONYMOUS_SESSION;

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      `id, first_name, last_name, display_name, company_name, role,
       account_status, onboarding_complete, access_rank_override,
       access_rank_override_expires_at`,
    )
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return ANONYMOUS_SESSION;

  const { data: subscriptionRow } = await supabase
    .from('subscriptions')
    .select(
      `status, current_period_end, cancel_at_period_end,
       subscription_plans!inner(code, name, access_rank, feature_configuration)`,
    )
    .eq('user_id', user.id)
    .maybeSingle();

  // PostgREST returns an embedded to-one relation as an object, but the
  // generated types allow an array; normalise both shapes.
  const planRelation = subscriptionRow?.subscription_plans as
    | {
        code: string;
        name: string;
        access_rank: number;
        feature_configuration: unknown;
      }
    | Array<{
        code: string;
        name: string;
        access_rank: number;
        feature_configuration: unknown;
      }>
    | null
    | undefined;
  const plan = Array.isArray(planRelation) ? planRelation[0] : planRelation;

  const planCode = (plan?.code ?? 'free') as PlanCode;

  const subscription: SubscriptionRecord | null = subscriptionRow
    ? {
        status: subscriptionRow.status as SubscriptionStatus,
        currentPeriodEnd: toDate(subscriptionRow.current_period_end),
        cancelAtPeriodEnd: Boolean(subscriptionRow.cancel_at_period_end),
        planAccessRank: plan?.access_rank ?? 0,
      }
    : null;

  const viewer = buildViewer(
    {
      userId: user.id,
      role: profile.role as UserRole,
      accountStatus: profile.account_status as AccountStatus,
      accessRankOverride: profile.access_rank_override,
      accessRankOverrideExpiresAt: toDate(
        profile.access_rank_override_expires_at,
      ),
    },
    subscription,
    plan ? parsePlanFeatures(plan.feature_configuration, planCode) : null,
  );

  return {
    viewer,
    subscription,
    planCode,
    planName: plan?.name ?? 'Free Preview',
    subscriptionStatus: subscription?.status ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    profile: {
      firstName: profile.first_name,
      lastName: profile.last_name,
      displayName: profile.display_name,
      companyName: profile.company_name,
      onboardingComplete: Boolean(profile.onboarding_complete),
    },
  };
});

export async function getViewer(): Promise<Viewer> {
  return (await getSessionContext()).viewer;
}

/** Throws unless the caller holds one of the given roles. */
export async function requireRole(
  ...roles: readonly UserRole[]
): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer.isAuthenticated || !roles.includes(viewer.role)) {
    throw new AuthorizationError('You do not have access to this area.');
  }
  if (viewer.accountStatus !== 'active') {
    throw new AuthorizationError('Your account is not active.');
  }
  return viewer;
}

export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}
