import { createHash } from 'node:crypto';

import {
  checkRateLimit,
  rateLimitIdentity,
  type RateLimitResult,
} from './rate-limit';

/** Both dimensions must pass; a combined IP/email key limits only the pair. */
export async function checkAuthRateLimit(
  action: 'login' | 'passwordReset',
  request: Request,
  email: string,
): Promise<RateLimitResult> {
  const ipLimit = await checkRateLimit(
    action,
    rateLimitIdentity(request, null),
  );
  // An already-blocked IP must not consume another address's allowance.
  if (!ipLimit.allowed) return ipLimit;

  const emailKey = createHash('sha256')
    .update(email.trim().toLowerCase())
    .digest('hex');
  return checkRateLimit(action, `email-sha256:${emailKey}`);
}
