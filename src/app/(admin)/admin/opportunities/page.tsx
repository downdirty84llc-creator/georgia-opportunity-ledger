import type { Metadata } from 'next';
import Link from 'next/link';

import { ButtonLink, EmptyState, Pill } from '@/components/ui/primitives';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, formatDeadline, titleCase } from '@/lib/format';

export const metadata: Metadata = { title: 'Opportunities — admin' };
export const dynamic = 'force-dynamic';

const WORKFLOW_FILTERS = [
  'draft',
  'internal_review',
  'approved',
  'scheduled',
  'published',
  'expired',
  'archived',
] as const;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminOpportunitiesPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const workflowStatus =
    typeof params.workflowStatus === 'string' ? params.workflowStatus : null;

  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from('opportunities')
    .select(
      `id, title, slug, category, workflow_status, status, score,
       closing_date, date_verified, reverification_due_at, updated_at, is_sample`,
    )
    .order('updated_at', { ascending: false })
    .limit(200);

  if (workflowStatus) query = query.eq('workflow_status', workflowStatus);

  const { data } = await query;
  const rows = data ?? [];
  const now = new Date();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl">Opportunity records</h1>
          <p className="mt-1 text-sm text-ink-600">
            Every record in the pipeline, most recently touched first.
          </p>
        </div>
        <ButtonLink href="/admin/opportunities/new">New record</ButtonLink>
      </div>

      <nav aria-label="Workflow filter" className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/admin/opportunities"
          className={
            !workflowStatus
              ? 'rounded-full bg-ink-900 px-3 py-1.5 text-sm font-medium text-white'
              : 'rounded-full border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-50'
          }
        >
          All
        </Link>
        {WORKFLOW_FILTERS.map((status) => (
          <Link
            key={status}
            href={`/admin/opportunities?workflowStatus=${status}`}
            className={
              workflowStatus === status
                ? 'rounded-full bg-ink-900 px-3 py-1.5 text-sm font-medium text-white'
                : 'rounded-full border border-ink-300 px-3 py-1.5 text-sm hover:bg-ink-50'
            }
          >
            {titleCase(status)}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No records here"
            description="Nothing matches this workflow filter. Start a new record to add one."
          >
            <ButtonLink href="/admin/opportunities/new">New record</ButtonLink>
          </EmptyState>
        </div>
      ) : (
        <div className="surface mt-6 overflow-x-auto">
          <table className="min-w-[880px] text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Title
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Category
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Workflow
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Score
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Deadline
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Verified
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const reverificationOverdue =
                  row.workflow_status === 'published' &&
                  row.reverification_due_at &&
                  new Date(row.reverification_due_at) <= now;
                return (
                  <tr
                    key={row.id}
                    className="border-b border-ink-100 last:border-0"
                  >
                    <td className="max-w-[300px] px-4 py-3">
                      <Link
                        href={`/admin/opportunities/${row.id}`}
                        className="font-medium hover:underline"
                      >
                        {row.title}
                      </Link>
                      {row.is_sample ? (
                        <span className="ml-2 align-middle">
                          <Pill tone="muted">Sample</Pill>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{titleCase(row.category)}</td>
                    <td className="px-4 py-3">
                      <Pill
                        tone={
                          row.workflow_status === 'published'
                            ? 'positive'
                            : row.workflow_status === 'internal_review'
                              ? 'warning'
                              : 'muted'
                        }
                      >
                        {titleCase(row.workflow_status)}
                      </Pill>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{row.score}</td>
                    <td className="px-4 py-3 text-ink-600">
                      {formatDeadline(row.closing_date)}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {formatDate(row.date_verified)}
                      {reverificationOverdue ? (
                        <span className="ml-2">
                          <Pill tone="warning">Reverify</Pill>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-ink-500">
                      {formatDate(row.updated_at)}
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
