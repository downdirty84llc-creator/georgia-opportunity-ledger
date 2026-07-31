import { NextResponse } from 'next/server';

import { getViewer } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ file: string }> };

/** Escapes the characters iCalendar treats as structural. */
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function toIcsDate(value: Date): string {
  return `${value.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/**
 * GET /api/v1/calendar/{opportunityId}.ics
 *
 * Emits a single VEVENT for one deadline, plus two alarms matching the
 * in-product reminder schedule. Row-level security decides whether the record
 * is readable, so a member cannot export a deadline from a record their plan
 * cannot open.
 */
export async function GET(
  _request: Request,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any,
): Promise<NextResponse> {
  const { file } = await (context as RouteContext).params;
  const id = file.replace(/\.ics$/i, '');

  const viewer = await getViewer();
  if (!viewer.isAuthenticated || viewer.accountStatus !== 'active') {
    return NextResponse.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Sign in to export a deadline.',
        },
      },
      { status: 401 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('opportunities')
    .select('id, slug, title, summary, closing_date, counties ( name )')
    .eq('id', id)
    .maybeSingle();

  if (!data?.closing_date) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'No deadline found.' } },
      { status: 404 },
    );
  }

  const county = data.counties as { name?: string } | null;
  const deadline = new Date(data.closing_date);
  const url = `${publicEnv.siteUrl.replace(/\/$/, '')}/opportunities/${data.slug}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Georgia Opportunity Ledger//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${data.id}@georgia-opportunity-ledger`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(deadline)}`,
    `DTEND:${toIcsDate(new Date(deadline.getTime() + 60 * 60 * 1000))}`,
    `SUMMARY:${escapeIcs(`Deadline: ${data.title}`)}`,
    `DESCRIPTION:${escapeIcs(
      `${data.summary}\n\nCounty: ${county?.name ?? 'Georgia'}\n${url}\n\n` +
        'Verify this deadline against the original source before relying on it.',
    )}`,
    `URL:${url}`,
    ...(county?.name
      ? [`LOCATION:${escapeIcs(`${county.name} County, Georgia`)}`]
      : []),
    'BEGIN:VALARM',
    'TRIGGER:-P7D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcs(`${data.title} closes in 7 days`)}`,
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-P2D',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeIcs(`${data.title} closes in 2 days`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // RFC 5545 requires CRLF line endings.
  return new NextResponse(lines.join('\r\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${data.slug}.ics"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
