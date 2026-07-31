import type { Metadata } from 'next';
import Link from 'next/link';

import {
  ButtonLink,
  EmptyState,
  LockedPanel,
  Pill,
  ScoreBadge,
} from '@/components/ui/primitives';
import { canViewDeadlineCalendar } from '@/lib/access/entitlements';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, formatDeadline } from '@/lib/format';
import type { ScoreClassification } from '@/lib/scoring/score';

export const metadata: Metadata = { title: 'Deadline calendar' };
export const dynamic = 'force-dynamic';

/** Groups deadlines into the horizons people actually plan against. */
const HORIZONS = [
  { key: 'overdue', label: 'Closed in the last week', from: -7, to: 0 },
  { key: 'week', label: 'Next 7 days', from: 0, to: 7 },
  { key: 'fortnight', label: '8 to 14 days', from: 7, to: 14 },
  { key: 'month', label: '15 to 30 days', from: 14, to: 30 },
  { key: 'later', label: 'Beyond 30 days', from: 30, to: 365 },
] as const;

export default async function CalendarPage() {
  const { viewer } = await getSessionContext();
  const decision = canViewDeadlineCalendar(viewer);

  if (!decision.allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl sm:text-3xl">Deadline calendar</h1>
        <p className="mt-2 text-ink-600">
          Every deadline you are tracking, grouped by how soon it lands.
        </p>
        <div className="mt-8">
          <LockedPanel
            title="The deadline calendar is included from Weekly upward"
            message={decision.message}
            requiredPlan={decision.requiredPlan}
            sections={[
              'Month, week and list views',
              'Deadlines from every record you have saved',
              'Reminders at 14, 7 and 2 days',
              'Export a deadline to your own calendar',
            ]}
          />
        </div>
      </div>
    );
  }

  const supabase = await createServerSupabaseClient();
  const horizonEnd = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const horizonStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const { data } = await supabase
    .from('saved_opportunities')
    .select(
      `id, status,
       opportunities!inner ( id, slug, title, category, score,
                             score_classification, closing_date,
                             minimum_access_rank )`,
    )
    .eq('user_id', viewer.userId)
    .not('opportunities.closing_date', 'is', null)
    .gte('opportunities.closing_date', horizonStart.toISOString())
    .lte('opportunities.closing_date', horizonEnd.toISOString());

  const entries = (data ?? [])
    .map((row) => {
      const opportunity = Array.isArray(row.opportunities)
        ? row.opportunities[0]
        : row.opportunities;
      return opportunity ? { savedStatus: row.status, opportunity } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort(
      (a, b) =>
        new Date(a.opportunity.closing_date).getTime() -
        new Date(b.opportunity.closing_date).getTime(),
    );

  const now = Date.now();
  const dayOffset = (iso: string) =>
    (new Date(iso).getTime() - now) / (24 * 60 * 60 * 1000);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl">Deadline calendar</h1>
          <p className="mt-1 text-sm text-ink-600">
            Deadlines from the {entries.length}{' '}
            {entries.length === 1 ? 'record' : 'records'} you are tracking.
            Reminders go out at 14, 7 and 2 days.
          </p>
        </div>
        <ButtonLink href="/saved" variant="secondary">
          Saved list
        </ButtonLink>
      </div>

      {entries.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No deadlines to show"
            description="Save a record with a deadline and it appears here, with reminders before it closes."
          >
            <ButtonLink href="/opportunities?closingSoon=true">
              Find records closing soon
            </ButtonLink>
          </EmptyState>
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {HORIZONS.map((horizon) => {
            const bucket = entries.filter((entry) => {
              const offset = dayOffset(entry.opportunity.closing_date);
              return offset >= horizon.from && offset < horizon.to;
            });
            if (bucket.length === 0) return null;

            return (
              <section key={horizon.key}>
                <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-ink-500">
                  {horizon.label}
                  <span className="ml-2 font-normal text-ink-500">
                    {bucket.length}
                  </span>
                </h2>
                <ul className="surface mt-3 divide-y divide-ink-100">
                  {bucket.map((entry) => {
                    const locked =
                      viewer.accessRank < entry.opportunity.minimum_access_rank;
                    return (
                      <li
                        key={entry.opportunity.id}
                        className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <Link
                            href={`/opportunities/${entry.opportunity.slug}`}
                            className="font-medium hover:underline"
                          >
                            {entry.opportunity.title}
                          </Link>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {formatDeadline(entry.opportunity.closing_date)} ·{' '}
                            {formatDate(entry.opportunity.closing_date)}
                          </p>
                          {locked ? (
                            <Pill tone="muted">Above your plan</Pill>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <ScoreBadge
                            score={entry.opportunity.score}
                            classification={
                              entry.opportunity
                                .score_classification as ScoreClassification
                            }
                            size="sm"
                          />
                          <a
                            href={`/api/v1/calendar/${entry.opportunity.id}.ics`}
                            className="rounded-md border border-ink-300 px-2 py-1 text-xs font-medium hover:bg-ink-50"
                          >
                            Add to calendar
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
