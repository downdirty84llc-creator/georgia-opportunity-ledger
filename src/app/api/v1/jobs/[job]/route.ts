import { NextResponse } from 'next/server';

import { serverEnv } from '@/lib/env';
import { findJob, jobNames } from '@/lib/jobs/registry';
import { runJob } from '@/lib/jobs/runner';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Jobs iterate over the whole member list; the default 10s budget is not enough.
export const maxDuration = 300;

type RouteContext = { params: Promise<{ job: string }> };

/**
 * POST /api/v1/jobs/{job}
 *
 * The scheduler's entry point. Authorised by a shared secret rather than a
 * session, and compared in constant time so the endpoint cannot be used as a
 * timing oracle for the secret.
 */
export async function POST(
  request: Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any,
): Promise<NextResponse> {
  const { job: jobName } = await (context as RouteContext).params;
  const env = serverEnv();

  const provided = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '');

  if (!provided || !timingSafeEqual(provided, env.cronSecret)) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Invalid job credentials.' } },
      { status: 401 },
    );
  }

  const definition = findJob(jobName);
  if (!definition) {
    return NextResponse.json(
      {
        error: {
          code: 'not_found',
          message: `Unknown job "${jobName}".`,
          details: { available: jobNames() },
        },
      },
      { status: 404 },
    );
  }

  try {
    const result = await runJob(definition);
    return NextResponse.json({
      data: {
        job: definition.name,
        skipped: result.skipped,
        processed: result.processed,
        failed: result.failed,
        detail: result.detail,
      },
    });
  } catch (error) {
    // A non-2xx tells the scheduler to retry.
    return NextResponse.json(
      {
        error: {
          code: 'internal_error',
          message: 'Job failed.',
          details: {
            job: definition.name,
            message: error instanceof Error ? error.message : String(error),
          },
        },
      },
      { status: 500 },
    );
  }
}

/**
 * Vercel Cron invokes with GET, so the same handler is exposed both ways. The
 * secret check is identical; there is no unauthenticated path in either.
 */
export const GET = POST;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}
