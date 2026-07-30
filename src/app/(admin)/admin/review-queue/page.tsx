import type { Metadata } from 'next';
import Link from 'next/link';

import { ReviewActions } from '@/components/admin/review-actions';
import { EmptyState, Pill, ScoreBadge } from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, formatDeadline, titleCase } from '@/lib/format';
import { roleMayPerform } from '@/lib/opportunities/workflow';
import type { ScoreClassification } from '@/lib/scoring/score';

export const metadata: Metadata = { title: 'Review queue' };
export const dynamic = 'force-dynamic';

export default async function ReviewQueuePage() {
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const canApprove = roleMayPerform(viewer.role, 'approve');
  const canPublish = roleMayPerform(viewer.role, 'publish');

  const { data } = await supabase
    .from('opportunities')
    .select(
      `id, title, slug, category, workflow_status, score, score_classification,
       closing_date, date_verified, created_by, updated_at,
       profiles:created_by ( display_name )`,
    )
    .in('workflow_status', ['internal_review', 'approved', 'scheduled'])
    .order('updated_at', { ascending: true })
    .limit(100);

  const rows = data ?? [];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">Review queue</h1>
      <p className="mt-1 text-sm text-ink-600">
        Records awaiting review, approval or publication, oldest first.
        {canApprove ? '' : ' Your role can view this queue but not act on it.'}
      </p>

      {rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="The queue is clear"
            description="Nothing is waiting for review. New submissions from researchers appear here."
          />
        </div>
      ) : (
        <div className="mt-8 surface overflow-x-auto">
          <table className="min-w-[880px] text-sm">
            <caption className="sr-only">Records awaiting editorial action</caption>
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left">
                <th scope="col" className="px-4 py-3 font-semibold">Title</th>
                <th scope="col" className="px-4 py-3 font-semibold">Category</th>
                <th scope="col" className="px-4 py-3 font-semibold">Researcher</th>
                <th scope="col" className="px-4 py-3 font-semibold">Verified</th>
                <th scope="col" className="px-4 py-3 font-semibold">Score</th>
                <th scope="col" className="px-4 py-3 font-semibold">Deadline</th>
                <th scope="col" className="px-4 py-3 font-semibold">Status</th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const researcher = Array.isArray(row.profiles)
                  ? row.profiles[0]
                  : row.profiles;
                return (
                  <tr key={row.id} className="border-b border-ink-100 align-top last:border-0">
                    <td className="max-w-[280px] px-4 py-3">
                      <Link
                        href={`/opportunities/${row.slug}`}
                        className="font-medium hover:underline"
                      >
                        {row.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{titleCase(row.category)}</td>
                    <td className="px-4 py-3 text-ink-600">
                      {researcher?.display_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {formatDate(row.date_verified)}
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBadge
                        score={row.score}
                        classification={
                          row.score_classification as ScoreClassification
                        }
                        size="sm"
                      />
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {formatDeadline(row.closing_date)}
                    </td>
                    <td className="px-4 py-3">
                      <Pill
                        tone={
                          row.workflow_status === 'internal_review'
                            ? 'warning'
                            : 'positive'
                        }
                      >
                        {titleCase(row.workflow_status)}
                      </Pill>
                    </td>
                    <td className="px-4 py-3">
                      <ReviewActions
                        opportunityId={row.id}
                        workflowStatus={row.workflow_status}
                        canApprove={canApprove}
                        canPublish={canPublish}
                      />
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
