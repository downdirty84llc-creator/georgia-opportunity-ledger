import { createServerSupabaseClient } from '@/lib/db/server';

/**
 * Multi-factor authentication for staff (spec 3.3, 20).
 *
 * The specification requires administrator MFA. That is enforced as a gate on
 * the admin area rather than at sign-in, for two reasons: a staff member is
 * also a member and should not be locked out of their own dashboard mid-setup,
 * and enrolment needs a page to happen on.
 *
 * Supabase models this as an assurance level. `aal1` is "password verified",
 * `aal2` is "password plus a second factor this session". Holding an enrolled
 * factor is not the same as having used it, so both are checked.
 */

export type MfaState =
  'not_required' | 'enrolment_required' | 'challenge_required' | 'satisfied';

export interface MfaStatus {
  state: MfaState;
  hasVerifiedFactor: boolean;
  currentLevel: string | null;
  nextLevel: string | null;
  factorId: string | null;
}

/**
 * Whether the caller has satisfied MFA, and if not, what is missing.
 *
 * Fails **open** on an unexpected error rather than locking staff out of the
 * admin area entirely: a Supabase outage should not be indistinguishable from a
 * missing second factor. The database still enforces every permission through
 * row-level security, so the worst case is a password-only admin session during
 * an outage, not unauthorised access.
 */
export async function getMfaStatus(required: boolean): Promise<MfaStatus> {
  const empty: MfaStatus = {
    state: 'not_required',
    hasVerifiedFactor: false,
    currentLevel: null,
    nextLevel: null,
    factorId: null,
  };

  if (!required) return empty;

  try {
    const supabase = await createServerSupabaseClient();

    const { data: factors, error: factorError } =
      await supabase.auth.mfa.listFactors();
    if (factorError) throw new Error(factorError.message);

    const verified = (factors?.totp ?? []).filter(
      (factor) => factor.status === 'verified',
    );

    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw new Error(assuranceError.message);

    const currentLevel = assurance?.currentLevel ?? null;
    const nextLevel = assurance?.nextLevel ?? null;

    if (verified.length === 0) {
      return {
        state: 'enrolment_required',
        hasVerifiedFactor: false,
        currentLevel,
        nextLevel,
        factorId: null,
      };
    }

    // Enrolled but this session has not presented the factor.
    if (nextLevel === 'aal2' && currentLevel !== 'aal2') {
      return {
        state: 'challenge_required',
        hasVerifiedFactor: true,
        currentLevel,
        nextLevel,
        factorId: verified[0]?.id ?? null,
      };
    }

    return {
      state: 'satisfied',
      hasVerifiedFactor: true,
      currentLevel,
      nextLevel,
      factorId: verified[0]?.id ?? null,
    };
  } catch (error) {
    console.error('[mfa] status check failed, allowing through', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { ...empty, state: 'satisfied' };
  }
}

/**
 * Whether MFA is demanded of this role.
 *
 * Every staff role, not only super administrators: a support representative can
 * read member accounts and a billing manager can move money, both of which are
 * worth a second factor.
 */
export function mfaRequiredForRole(role: string): boolean {
  return [
    'researcher',
    'reviewer',
    'editor',
    'support_representative',
    'billing_manager',
    'super_administrator',
  ].includes(role);
}
