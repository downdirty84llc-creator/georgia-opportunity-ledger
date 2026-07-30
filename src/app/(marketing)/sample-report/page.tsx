import type { Metadata } from 'next';

import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import {
  ButtonLink,
  LockedPanel,
  Pill,
  SectionHeading,
} from '@/components/ui/primitives';
import { formatDate, formatDeadline } from '@/lib/format';
import {
  loadIndicatorPreviews,
  loadPreviewOpportunities,
} from '@/lib/public-data';

export const revalidate = 900;

export const metadata: Metadata = {
  title: 'Sample weekly report',
  description:
    'A complete example of the weekly report: executive summary, one full ' +
    'record, the deadline calendar and the pricing indicators.',
  alternates: { canonical: '/sample-report' },
};

export default async function SampleReportPage() {
  const [records, closingSoon, indicators] = await Promise.all([
    loadPreviewOpportunities({ limit: 5 }),
    loadPreviewOpportunities({ limit: 6, closingSoon: true }),
    loadIndicatorPreviews(6),
  ]);

  const [featured, ...locked] = records;

  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <Pill>Sample</Pill>
      <h1 className="mt-3 text-3xl sm:text-4xl">
        The weekly report, in full
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-ink-700">
        This is the structure every weekly report follows. One record is shown
        complete so you can see exactly what members read; the rest are shown as
        members below the required tier would see them.
      </p>

      <section className="mt-12">
        <SectionHeading eyebrow="Section one" title="Executive summary" />
        <div className="prose-ledger">
          <p>
            The week&rsquo;s ledger is weighted toward deadline pressure rather
            than new inventory: several programs close inside the next fortnight
            and two property registrations close sooner than their sale dates
            suggest. Where a deadline and a sale date differ, the deadline is the
            one that binds.
          </p>
          <p>
            On pricing, the picture is mixed. Input costs remain the constraint
            on new construction, while lending conditions have moved enough that
            deals underwritten earlier in the year should be re-run before they
            are committed.
          </p>
          <p>
            If you read one thing this week, read the record below. It is the
            highest-scoring item in the ledger, and the reason is set out
            component by component rather than asserted.
          </p>
        </div>
      </section>

      {featured ? (
        <section className="mt-12">
          <SectionHeading
            eyebrow="Section two"
            title="One complete record"
            description="Unlocked in full, exactly as a Detailed or Premium member sees it in the report."
          />
          <OpportunityCard opportunity={{ ...featured, isLocked: false }} />
        </section>
      ) : null}

      {locked.length > 0 ? (
        <section className="mt-12">
          <SectionHeading
            eyebrow="Section three"
            title="The rest of the week"
            description="Shown here the way a member below the required tier sees them — title, score, county and deadline, with the analysis withheld."
          />
          <div className="grid gap-4">
            {locked.map((record) => (
              <OpportunityCard
                key={record.id}
                opportunity={{ ...record, isLocked: true }}
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-12">
        <SectionHeading
          eyebrow="Section four"
          title="Deadline calendar"
          description="Everything closing in the next fortnight, exportable to your own calendar."
        />
        {closingSoon.length > 0 ? (
          <ul className="surface divide-y divide-ink-100">
            {closingSoon.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3"
              >
                <span className="text-sm font-medium">{item.title}</span>
                <span className="text-xs text-ink-500">
                  {item.county ?? 'Georgia'} · {formatDeadline(item.closingDate)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="surface px-5 py-6 text-sm text-ink-600">
            Nothing is closing in the next fortnight.
          </p>
        )}
      </section>

      <section className="mt-12">
        <SectionHeading
          eyebrow="Section five"
          title="Pricing indicators"
          description="Direction is shown to everyone. Levels, history and interpretation are included with Detailed Intelligence."
        />
        <dl className="surface divide-y divide-ink-100">
          {indicators.map((indicator) => (
            <div
              key={indicator.id}
              className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3"
            >
              <dt className="text-sm">{indicator.name}</dt>
              <dd className="text-right">
                <span className="text-sm font-semibold tabular-nums">
                  {indicator.percentChange === null
                    ? '—'
                    : `${indicator.percentChange > 0 ? '+' : ''}${indicator.percentChange.toFixed(1)}%`}
                </span>
                <span className="block text-xs text-ink-500">
                  Period ending {formatDate(indicator.periodEnd)}
                </span>
              </dd>
            </div>
          ))}
          {indicators.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-600">
              Indicators appear here once observations have been loaded.
            </p>
          ) : null}
        </dl>
      </section>

      <div className="mt-12">
        <LockedPanel
          title="The full report is included from Weekly upward"
          message="Weekly members receive this report every Thursday with summary detail. Detailed adds full analysis and score explanations; Premium adds immediate alerts, saved searches and CSV export."
          sections={[
            'Full analysis on every record',
            'Score explanations',
            'Complete report archive',
            'Pricing dashboard',
            'Deadline calendar export',
            'Immediate alerts (Premium)',
          ]}
        />
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href="/pricing">Compare membership plans</ButtonLink>
        <ButtonLink href="/register" variant="secondary">
          Start with the free tier
        </ButtonLink>
      </div>
    </div>
  );
}
