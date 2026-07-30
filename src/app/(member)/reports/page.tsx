import type { Metadata } from 'next';
import Link from 'next/link';

import { ButtonLink, EmptyState, Pill } from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, titleCase } from '@/lib/format';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

const LIMITED_ARCHIVE_COUNT = 4;

export default async function ReportsPage() {
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const { data } = await supabase
    .from('report_previews')
    .select('*')
    .order('published_at', { ascending: false })
    .limit(60);

  const reports = (data ?? []).map((report, index) => ({
    ...report,
    isLocked:
      !viewer.isStaff &&
      !report.is_sample &&
      (viewer.accessRank < report.minimum_access_rank ||
        (viewer.features.reportArchive === 'limited' &&
          index >= LIMITED_ARCHIVE_COUNT)),
  }));

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">Reports</h1>
      <p className="mt-1 text-sm text-ink-600">
        {viewer.features.reportArchive === 'full' || viewer.isStaff
          ? 'The complete archive.'
          : 'Your plan includes the most recent reports. Detailed Intelligence opens the full archive.'}
      </p>

      {reports.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No reports published yet"
            description="The weekly report is published every Thursday. Once the first one is out it appears here."
          >
            <ButtonLink href="/sample-report">Read a sample report</ButtonLink>
          </EmptyState>
        </div>
      ) : (
        <ul className="mt-8 space-y-3">
          {reports.map((report) => (
            <li key={report.id} className="surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="muted">{titleCase(report.report_type)}</Pill>
                    {report.is_sample ? <Pill>Sample</Pill> : null}
                    {report.isLocked ? <Pill tone="warning">Locked</Pill> : null}
                  </div>
                  <h2 className="mt-2 text-base font-semibold">
                    {report.isLocked ? (
                      report.title
                    ) : (
                      <Link
                        href={`/reports/${report.slug}`}
                        className="hover:underline"
                      >
                        {report.title}
                      </Link>
                    )}
                  </h2>
                  <p className="mt-1 text-sm text-ink-500">
                    {report.reporting_period_start && report.reporting_period_end
                      ? `${formatDate(report.reporting_period_start)} – ${formatDate(report.reporting_period_end)}`
                      : `Published ${formatDate(report.published_at)}`}
                  </p>
                </div>
                {report.isLocked ? (
                  <ButtonLink href="/pricing" variant="secondary">
                    Unlock
                  </ButtonLink>
                ) : (
                  <ButtonLink href={`/reports/${report.slug}`} variant="secondary">
                    Read
                  </ButtonLink>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
