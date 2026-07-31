import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import type { Decision } from '@/lib/access/entitlements';
import { reportError } from '@/lib/observability/report-error';

/**
 * One response shape for the whole API, so a client never has to guess where
 * the error text lives.
 *
 *   success: { data, meta? }
 *   failure: { error: { code, message, details? } }
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'upgrade_required'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'validation_failed'
  | 'internal_error';

const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  // 402 is the honest status for "your plan does not include this", and it
  // lets the client show an upgrade prompt without string-matching a message.
  upgrade_required: 402,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  validation_failed: 422,
  internal_error: 500,
};

export interface ApiMeta {
  nextCursor?: string | null;
  count?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export function ok<T>(
  data: T,
  meta?: ApiMeta,
  init?: ResponseInit,
): NextResponse {
  return NextResponse.json(meta ? { data, meta } : { data }, {
    status: 200,
    ...init,
  });
}

export function created<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ data }, { status: 201, ...init });
}

export function noContent(init?: ResponseInit): NextResponse {
  return new NextResponse(null, { status: 204, ...init });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  init?: ResponseInit,
): NextResponse {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status: STATUS_BY_CODE[code], ...init },
  );
}

/** Turns an entitlement decision into the matching HTTP failure. */
export function denied(decision: Decision): NextResponse {
  switch (decision.reason) {
    case 'authentication_required':
      return apiError('unauthorized', decision.message);
    case 'upgrade_required':
    case 'limit_reached':
      return apiError('upgrade_required', decision.message, {
        requiredPlan: decision.requiredPlan,
        requiredRank: decision.requiredRank,
        reason: decision.reason,
      });
    case 'account_suspended':
      return apiError('forbidden', decision.message);
    case 'not_published':
      return apiError('not_found', 'Record not found.');
    default:
      return apiError('forbidden', decision.message || 'Not permitted.');
  }
}

export function validationFailed(error: ZodError): NextResponse {
  return apiError('validation_failed', 'Some fields need attention.', {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  });
}

export function rateLimited(resetAt: Date): NextResponse {
  const retryAfter = Math.max(
    1,
    Math.ceil((resetAt.getTime() - Date.now()) / 1000),
  );
  return apiError(
    'rate_limited',
    'Too many requests. Please wait a moment and try again.',
    undefined,
    { headers: { 'Retry-After': String(retryAfter) } },
  );
}

/**
 * Wraps a handler so an unexpected throw becomes a 500 with no internal detail
 * in the body. The detail goes to the server log, where it belongs.
 */
export function withErrorHandling(
  handler: (request: Request, context: never) => Promise<NextResponse>,
) {
  return async (request: Request, context: never): Promise<NextResponse> => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof ZodError) return validationFailed(error);

      // Reported rather than only logged: an unhandled API error is the class
      // of failure that silently loses a member's work.
      await reportError(error, {
        scope: 'api',
        tags: { method: request.method, path: new URL(request.url).pathname },
      });
      return apiError(
        'internal_error',
        'Something went wrong on our side. The team has been notified.',
      );
    }
  };
}
