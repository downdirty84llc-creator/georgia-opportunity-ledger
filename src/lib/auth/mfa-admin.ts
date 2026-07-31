import { createAdminClient } from '@/lib/db/admin';
import { createServerSupabaseClient } from '@/lib/db/server';
import { mfaRequiredForRole } from '@/lib/auth/mfa';

/**
 * Recovery for a staff member who has lost their authenticator.
 *
 * Until now this needed someone with a Supabase dashboard login, which meant
 * the recovery path for the admin area sat outside the admin area — untracked,
 * unaudited, and available to anyone holding infrastructure credentials rather
 * than to the role the specification actually assigns it to.
 *
 * The rules below are what make an in-product reset safe to offer:
 *
 *   - Only a super administrator may perform one. Support representatives can
 *     read member accounts, which is exactly the position from which a reset
 *     of someone else's second factor would be most useful to an attacker.
 *   - Nobody may reset their own. A reset is a *recovery* mechanism, so it must
 *     require a second person; otherwise a session that got past the password
 *     alone could shed the factor it could not present.
 *   - Every reset is audited before it is announced, and the audit row names
 *     the actor, the target and the factors removed.
 *
 * Deleting the factor does not sign the target out or touch their password.
 * They keep member access throughout and are asked to enrol again the next
 * time they open the admin area, which is the same gate as a new starter.
 */

export interface StaffFactorSummary {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: string;
  accountStatus: string;
  mfaRequired: boolean;
  verifiedFactors: number;
  unverifiedFactors: number;
  lastEnrolledAt: string | null;
}

export class MfaResetError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'MfaResetError';
  }
}

const STAFF_ROLES = [
  'researcher',
  'reviewer',
  'editor',
  'support_representative',
  'billing_manager',
  'super_administrator',
] as const;

/**
 * Every staff account with its enrolment state.
 *
 * The profile read goes through the caller's own session client so row-level
 * security still applies; only the factor counts, which no ordinary client can
 * see for another user, come from the service role.
 */
export async function listStaffFactors(): Promise<StaffFactorSummary[]> {
  const supabase = await createServerSupabaseClient();

  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, display_name, first_name, last_name, role, account_status')
    .in('role', STAFF_ROLES)
    .order('role', { ascending: true });

  if (error) throw new Error(error.message);

  const admin = createAdminClient();

  return Promise.all(
    (profiles ?? []).map(async (profile) => {
      const [{ data: userData }, { data: factorData }] = await Promise.all([
        admin.auth.admin.getUserById(profile.id),
        admin.auth.admin.mfa.listFactors({ userId: profile.id }),
      ]);

      const factors = factorData?.factors ?? [];
      const verified = factors.filter((factor) => factor.status === 'verified');
      const enrolled = factors
        .map((factor) => factor.created_at)
        .filter((value): value is string => Boolean(value))
        .sort();

      const name =
        profile.display_name ??
        [profile.first_name, profile.last_name].filter(Boolean).join(' ') ??
        null;

      return {
        userId: profile.id,
        email: userData?.user?.email ?? null,
        displayName: name || null,
        role: profile.role as string,
        accountStatus: profile.account_status as string,
        mfaRequired: mfaRequiredForRole(profile.role as string),
        verifiedFactors: verified.length,
        unverifiedFactors: factors.length - verified.length,
        lastEnrolledAt: enrolled.at(-1) ?? null,
      } satisfies StaffFactorSummary;
    }),
  );
}

export interface MfaResetResult {
  userId: string;
  factorsRemoved: number;
}

/**
 * Clears every enrolled factor on a staff account.
 *
 * `actorId` and `actorRole` come from the resolved session, never from the
 * request body — the whole point of the check is that the caller cannot state
 * their own authority.
 */
export async function resetStaffMfa(
  actorId: string,
  actorRole: string,
  targetUserId: string,
  reason: string,
): Promise<MfaResetResult> {
  if (actorRole !== 'super_administrator') {
    throw new MfaResetError(
      'Only a super administrator may reset two-factor enrolment.',
      403,
    );
  }

  if (actorId === targetUserId) {
    throw new MfaResetError(
      'You cannot reset your own two-factor enrolment. A reset is a recovery ' +
        'path and needs a second person; ask another super administrator.',
      409,
    );
  }

  const supabase = await createServerSupabaseClient();

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('id, role, display_name')
    .eq('id', targetUserId)
    .maybeSingle();

  if (targetError) throw new Error(targetError.message);
  if (!target) throw new MfaResetError('No such staff account.', 404);
  if (!mfaRequiredForRole(target.role as string)) {
    throw new MfaResetError(
      'That account is not a staff account, so it has no admin-area ' +
        'enrolment to clear.',
      409,
    );
  }

  const admin = createAdminClient();

  const { data: factorData, error: factorError } =
    await admin.auth.admin.mfa.listFactors({ userId: targetUserId });
  if (factorError) throw new Error(factorError.message);

  const factors = factorData?.factors ?? [];
  if (factors.length === 0) {
    throw new MfaResetError(
      'That account has no enrolled factors. If they cannot get in, the ' +
        'problem is elsewhere.',
      409,
    );
  }

  // Audit first. If the delete then fails we have recorded an attempt that did
  // not happen, which is recoverable; the reverse — a cleared factor with no
  // record of who cleared it — is not.
  const { error: auditError } = await supabase.rpc('log_admin_action', {
    p_action: 'staff.mfa_reset',
    p_entity_type: 'profile',
    p_entity_id: targetUserId,
    p_previous: {
      factors: factors.map((factor) => ({
        id: factor.id,
        type: factor.factor_type,
        status: factor.status,
      })),
    },
    p_new: { reason, factors: [] },
  });
  if (auditError) throw new Error(auditError.message);

  for (const factor of factors) {
    const { error } = await admin.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId: targetUserId,
    });
    if (error) throw new Error(error.message);
  }

  return { userId: targetUserId, factorsRemoved: factors.length };
}
