import { readJsonBody } from '@/lib/http/request-body';
import { z } from 'zod';
import { getViewer } from '@/lib/auth/session';
import { mfaRequiredForRole } from '@/lib/auth/mfa';
import { createServerSupabaseClient } from '@/lib/db/server';
import { checkRateLimit, rateLimitIdentity } from '@/lib/http/rate-limit';
import {
  apiError,
  ok,
  rateLimited,
  validationFailed,
  withErrorHandling,
} from '@/lib/http/responses';

export const dynamic = 'force-dynamic';
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enroll') }).strict(),
  z
    .object({
      action: z.literal('verify'),
      factorId: z.string().uuid(),
      code: z.string().regex(/^\d{6}$/),
    })
    .strict(),
]);

/** Uses the HttpOnly session throughout; verification never returns tokens. */
export const POST = withErrorHandling(async (request: Request) => {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return apiError('forbidden', 'Open the Security page on this site.');
  }
  const viewer = await getViewer();
  if (
    !viewer.isAuthenticated ||
    viewer.accountStatus !== 'active' ||
    !mfaRequiredForRole(viewer.role)
  ) {
    return apiError('forbidden', 'Active staff access required.');
  }
  const parsed = schema.safeParse(await readJsonBody(request));
  if (!parsed.success) return validationFailed(parsed.error);
  const limit = await checkRateLimit(
    'mfa',
    rateLimitIdentity(request, viewer.userId),
  );
  if (!limit.allowed) return rateLimited(limit.resetAt);
  const supabase = await createServerSupabaseClient();
  if (parsed.data.action === 'enroll') {
    const { data: factors, error: factorError } =
      await supabase.auth.mfa.listFactors();
    if (factorError || !factors)
      return apiError(
        'bad_request',
        'Could not check your authenticator setup. Try again.',
      );
    if (factors.all.some((factor) => factor.status === 'verified'))
      return apiError(
        'bad_request',
        'An authenticator is already active. Reload this page and enter its current code.',
      );

    // Leaving or reloading setup loses the QR but leaves an unverified factor.
    // Retrying the fixed friendly name then fails with mfa_factor_name_conflict.
    // Only clean up this session owner's unfinished Ledger TOTP enrollment.
    // Use the session API, never the admin API: if a concurrent verification
    // completes, Supabase requires aal2 before removing that verified factor.
    for (const factor of factors.all) {
      if (
        factor.factor_type !== 'totp' ||
        factor.status !== 'unverified' ||
        factor.friendly_name !== 'Ledger staff'
      )
        continue;
      const { error: cleanupError } = await supabase.auth.mfa.unenroll({
        factorId: factor.id,
      });
      if (cleanupError)
        return apiError(
          'bad_request',
          'Could not restart the unfinished setup. Reload this page and try again.',
        );
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Ledger staff',
    });
    if (error || !data)
      return apiError(
        'bad_request',
        'Enrolment could not be started. Try again.',
      );
    return ok(
      {
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      },
      undefined,
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error)
    return apiError(
      'bad_request',
      'That code was not accepted. Try the current code from your authenticator.',
    );
  return ok({ verified: true }, undefined, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
