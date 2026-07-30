import type { Metadata } from 'next';
import Link from 'next/link';

import { NewReportButton } from '@/components/admin/new-report-button';
import { EmptyState, Pill } from '@/components/ui/primitives';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, titleCase } from '@/lib/format';

export const metadata: Metadata = { title: 'Reports — admin' };
export const dynamic = 'force-dynamic';

export default async function AdminReportsPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('reports')
    .select(
      `id, title, slug, report_type, status, minimum_access_rank,
       scheduled_at, published_at, distributed_at, pdf_file_path, is_sample,
       created_at`,
    )
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl">Reports</h1>
          <p className="mt-1 text-sm text-ink-600">
            Drafting, approval, scheduling and distribution state for every report.
          </p>
        </div>
        <NewReportButton />
      </div>

      {rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No reports yet"
            description="Create one and compose it from your published records."
          >
            <NewReportButton />
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 surface overflow-x-auto">
          <table className="min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left">
                <th scope="col" className="px-4 py-3 font-semibold">Title</th>
                <th scope="col" className="px-4 py-3 font-semibold">Type</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">Tier</th>
                <th scope="col" className="px-4 py-3 font-semibold">Published</th>
                <th scope="col" className="px-4 py-3 font-semibold">Emailed</th>
                <th scope="col" className="px-4 py-3 font-semibold">PDF</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-ink-100 last:border-0">
                  <td className="max-w-[300px] px-4 py-3">
                    <Link
                      href={`/admin/reports/${row.id}`}
                      className="font-medium hover:underline"
                    >
                      {row.title}
                    </Link>
                    {row.is_sample ? (
                      <span className="ml-2">
                        <Pill tone="muted">Sample</Pill>
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{titleCase(row.report_type)}</td>
                  <td className="px-4 py-3">
                    <Pill
                      tone={
                        row.status === 'published'
                          ? 'positive'
                          : row.status === 'draft'
                            ? 'muted'
                            : 'warning'
                      }
                    >
                      {titleCase(row.status)}
                    </Pill>
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {row.minimum_access_rank}
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    {formatDate(row.published_at)}
                  </td>
                  <td className="px-4 py-3 text-ink-600">
                    {row.distributed_at ? formatDate(row.distributed_at) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {row.pdf_file_path ? (
                      <Pill tone="positive">Generated</Pill>
                    ) : (
                      <Pill tone="muted">None</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
