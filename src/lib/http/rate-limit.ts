import { createAdminClient } from '@/lib/db/admin';

/**
 * Rate limits, keyed by action (spec 20).
 *
 * Numbers are deliberately generous for member-facing reads and tight for the
 * endpoints that cost money or leak information under brute force: sign-in,
 * password reset, registration, and anything that generates a file.
 */
export const RATE_LIMITS = {
  login: { limit: 10, windowSeconds: 300 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
  register: { limit: 5, windowSeconds: 3600 },
  contact: { limit: 5, windowSeconds: 3600 },
  search: { limit: 120, windowSeconds: 60 },
  export: { limit: 10, windowSeconds: 3600 },
  reportGeneration: { limit: 20, windowSeconds: 3600 },
  adminPublish: { limit: 60, windowSeconds: 3600 },
  correction: { limit: 10, windowSeconds: 3600 },
  // Uploads are read whole into memory and posted to the scanner, so this
  // limit is about protecting the scanner and the function's memory, not
  // about abuse: editorial staff rarely attach more than a handful an hour.
  upload: { limit: 40, windowSeconds: 3600 },
} as const;

export type RateLimitAction = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

/**
 * Identifies the caller for limiting purposes. A signed-in member is limited
 * per account; everyone else per client IP taken from the proxy headers.
 */
export function rateLimitIdentity(
  request: Request,
  userId: string | null,
): string {
  if (userId) return `user:${userId}`;

  const forwarded = request.headers.get('x-forwarded-for');
  const ip =
    forwarded?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown';
  return `ip:${ip}`;
}

export async function checkRateLimit(
  action: RateLimitAction,
  identity: string,
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[action];
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .rpc('check_rate_limit', {
      p_key: `${action}:${identity}`,
      p_limit: config.limit,
      p_window_seconds: config.windowSeconds,
    })
    .single();

  if (error || !data) {
    // Fail open on limiter faults. A database hiccup should not lock every
    // member out of search; the failure is logged and the request proceeds.
    console.error('[rate-limit] check failed, allowing request', {
      action,
      error: error?.message,
    });
    return {
      allowed: true,
      remaining: config.limit,
      resetAt: new Date(Date.now() + config.windowSeconds * 1000),
      limit: config.limit,
    };
  }

  const row = data as { allowed: boolean; remaining: number; reset_at: string };
  return {
    allowed: row.allowed,
    remaining: row.remaining,
    resetAt: new Date(row.reset_at),
    limit: config.limit,
  };
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt.getTime() / 1000)),
  };
}
