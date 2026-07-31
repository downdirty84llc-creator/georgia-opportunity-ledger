import type { Metadata } from 'next';

import { EmptyState, Pill } from '@/components/ui/primitives';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, titleCase } from '@/lib/format';

export const metadata: Metadata = { title: 'Sources — admin' };
export const dynamic = 'force-dynamic';

export default async function AdminSourcesPage() {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('sources')
    .select(
      `id, name, organization_name, source_type, website_url,
       reliability_score, update_frequency, last_checked_at, next_check_at,
       automation_allowed, scraping_review_status, is_active`,
    )
    .order('name', { ascending: true })
    .limit(200);

  const rows = data ?? [];
  const now = new Date();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">Sources</h1>
      <p className="mt-1 text-sm text-ink-600">
        Every source the ledger monitors, its reliability rating, and when it
        was last checked. Automation stays off until a terms review records a
        permissive outcome — the database enforces that ordering.
      </p>

      {rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No sources yet"
            description="Sources are loaded by the seed and managed through the API."
          />
        </div>
      ) : (
        <div className="surface mt-8 overflow-x-auto">
          <table className="min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Source
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Type
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Reliability
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Cadence
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Last checked
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Automation
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overdue =
                  row.is_active &&
                  (!row.next_check_at || new Date(row.next_check_at) <= now);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-ink-100 last:border-0"
                  >
                    <td className="max-w-[300px] px-4 py-3">
                      <a
                        href={row.website_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium hover:underline"
                      >
                        {row.name}
                      </a>
                      {row.organization_name ? (
                        <p className="text-xs text-ink-500">
                          {row.organization_name}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{titleCase(row.source_type)}</td>
                    <td className="px-4 py-3 tabular-nums">
                      {row.reliability_score} / 15
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {row.update_frequency
                        ? titleCase(row.update_frequency)
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {formatDate(row.last_checked_at)}
                      {overdue ? (
                        <span className="ml-2">
                          <Pill tone="warning">Check due</Pill>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {row.automation_allowed ? (
                        <Pill tone="positive">Permitted</Pill>
                      ) : (
                        <Pill tone="muted">
                          {titleCase(row.scraping_review_status)}
                        </Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
