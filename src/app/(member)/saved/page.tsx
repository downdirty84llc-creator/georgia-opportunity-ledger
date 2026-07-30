import type { Metadata } from 'next';
import Link from 'next/link';

import { ExportButton } from '@/components/opportunities/export-button';
import {
  ButtonLink,
  EmptyState,
  Pill,
  ScoreBadge,
} from '@/components/ui/primitives';
import { canExportCsv } from '@/lib/access/entitlements';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, formatDeadline, titleCase } from '@/lib/format';
import type { ScoreClassification } from '@/lib/scoring/score';

export const metadata: Metadata = { title: 'Saved opportunities' };
export const dynamic = 'force-dynamic';

export default async function SavedPage() {
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const { data } = await supabase
    .from('saved_opportunities')
    .select(
      `id, status, personal_notes, follow_up_date, saved_at,
       opportunities ( id, slug, title, category, status, score,
                       score_classification, closing_date, is_closing_soon,
                       is_expired, minimum_access_rank, updated_at, is_sample )`,
    )
    .eq('user_id', viewer.userId)
    .order('saved_at', { ascending: false });

  const rows = (data ?? []).map((row) => {
    const opportunity = Array.isArray(row.opportunities)
      ? row.opportunities[0]
      : row.opportunities;
    return { saved: row, opportunity };
  });

  const exportDecision = canExportCsv(viewer);
  const limit = viewer.features.savedOpportunityLimit;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl">Saved opportunities</h1>
          <p className="mt-1 text-sm text-ink-600">
            {rows.length} saved
            {limit !== null ? ` of ${limit} available on your plan` : ''}.
            Everything here stays in your account even if your subscription
            lapses.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/calendar" variant="secondary">
            Calendar view
          </ButtonLink>
          <ExportButton
            allowed={exportDecision.allowed}
            deniedMessage={exportDecision.message}
            opportunityIds={rows
              .map((row) => row.opportunity?.id)
              .filter((id): id is string => Boolean(id))}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Nothing saved yet"
            description="Saving a record keeps it here with your own status, notes and follow-up date, and puts its deadline in your calendar."
          >
            <ButtonLink href="/opportunities">Browse opportunities</ButtonLink>
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 surface overflow-x-auto">
          <table className="min-w-[820px] text-sm">
            <caption className="sr-only">Your saved opportunities</caption>
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-left">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Opportunity
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Your status
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Follow-up
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Deadline
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ saved, opportunity }) => {
                const changedSinceSaved =
                  opportunity &&
                  new Date(opportunity.updated_at) > new Date(saved.saved_at);
                const locked =
                  opportunity &&
                  viewer.accessRank < opportunity.minimum_access_rank;

                return (
                  <tr
                    key={saved.id}
                    className="border-b border-ink-100 align-top last:border-0"
                  >
                    <td className="px-4 py-3">
                      {opportunity ? (
                        <Link
                          href={`/opportunities/${opportunity.slug}`}
                          className="font-medium hover:underline"
                        >
                          {opportunity.title}
                        </Link>
                      ) : (
                        <span className="text-ink-500">Record removed</span>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {opportunity ? (
                          <Pill tone="muted">{titleCase(opportunity.category)}</Pill>
                        ) : null}
                        {changedSinceSaved ? (
                          <Pill tone="warning">Updated since you saved it</Pill>
                        ) : null}
                        {locked ? <Pill tone="muted">Above your plan</Pill> : null}
                        {opportunity?.is_expired ? (
                          <Pill tone="muted">Closed</Pill>
                        ) : null}
                      </div>
                      {saved.personal_notes ? (
                        <p className="mt-2 max-w-md text-xs text-ink-600">
                          {saved.personal_notes}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{titleCase(saved.status)}</td>
                    <td className="px-4 py-3">
                      {saved.follow_up_date
                        ? formatDate(saved.follow_up_date)
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {opportunity
                        ? formatDeadline(opportunity.closing_date)
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {opportunity ? (
                        <ScoreBadge
                          score={opportunity.score}
                          classification={
                            opportunity.score_classification as ScoreClassification
                          }
                          size="sm"
                        />
                      ) : (
                        '—'
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
