import type { Metadata } from 'next';

import { ButtonLink, Card, Pill, SectionHeading } from '@/components/ui/primitives';
import { formatDate, titleCase } from '@/lib/format';
import { loadIndicatorPreviews } from '@/lib/public-data';

export const revalidate = 900;

export const metadata: Metadata = {
  title: 'Market pricing reports',
  description:
    'Construction costs, materials, industrial rents, vacancy, lending rates, ' +
    'labour, fuel and permit activity for Georgia — tracked monthly with the ' +
    'source named.',
  alternates: { canonical: '/pricing-reports' },
};

function trendLabel(trend: string | null, change: number | null): string {
  if (change === null) return 'No change recorded';
  const direction = trend === 'up' ? 'up' : trend === 'down' ? 'down' : 'flat';
  return `${direction === 'flat' ? 'Flat' : direction === 'up' ? 'Up' : 'Down'} ${Math.abs(change).toFixed(1)}%`;
}

export default async function PricingReportsPage() {
  const indicators = await loadIndicatorPreviews(20);

  const grouped = indicators.reduce<Record<string, typeof indicators>>(
    (accumulator, indicator) => {
      const bucket = accumulator[indicator.category] ?? [];
      bucket.push(indicator);
      accumulator[indicator.category] = bucket;
      return accumulator;
    },
    {},
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl sm:text-4xl">
          The numbers that decide whether the deal still works
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-700">
          A property that penciled in March may not pencil now. We track the
          input costs, rents, vacancy and lending conditions that move
          underwriting in Georgia, publish the movement with the source named,
          and say what it means rather than leaving you a chart.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <ButtonLink href="/pricing">See membership plans</ButtonLink>
          <ButtonLink href="/sample-report" variant="secondary">
            Read a sample report
          </ButtonLink>
        </div>
      </div>

      <section className="mt-14">
        <SectionHeading
          eyebrow="Tracked indicators"
          title="What we publish"
          description="Direction and movement are shown to everyone. The levels, the history and the interpretation are included with Detailed Intelligence and above."
        />

        {Object.keys(grouped).length === 0 ? (
          <p className="surface px-5 py-8 text-sm text-ink-600">
            Indicators appear here once observations have been loaded.
          </p>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-ink-500">
                  {titleCase(category)}
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((indicator) => (
                    <Card key={indicator.id} as="article">
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="text-base font-semibold leading-snug">
                          {indicator.name}
                        </h4>
                        {indicator.minimumAccessRank > 0 ? (
                          <Pill tone="muted">Members</Pill>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-ink-500">
                        {indicator.scope} · {indicator.unit}
                      </p>
                      <p className="mt-3 text-sm font-medium text-ink-900">
                        {trendLabel(indicator.trend, indicator.percentChange)}
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        Period ending {formatDate(indicator.periodEnd)}
                      </p>
                      {indicator.isSample ? (
                        <p className="mt-3 rounded bg-purple-50 px-2 py-1 text-xs text-purple-900">
                          Sample observation — illustrative only.
                        </p>
                      ) : null}
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-14 grid gap-8 lg:grid-cols-2">
        <div>
          <SectionHeading
            eyebrow="Method"
            title="How the pricing data is handled"
          />
          <div className="prose-ledger max-w-none">
            <p>
              Every observation records the reporting period it covers, the
              previous value, and the source URL. Percentage change and
              direction are derived by the database from the values themselves,
              so a typo in a hand-entered change figure is not possible — there
              is no hand-entered change figure.
            </p>
            <p>
              Where an indicator is a composite or a regional proxy rather than
              a Georgia-specific series, the scope field says so. We would
              rather publish an honest proxy labelled as one than imply a
              precision the underlying data does not have.
            </p>
          </div>
        </div>

        <div>
          <SectionHeading eyebrow="Included with" title="Who sees what" />
          <ul className="surface divide-y divide-ink-100 text-sm">
            <li className="px-5 py-3">
              <strong className="font-semibold">Free and Weekly.</strong> The
              indicator list and its direction of travel.
            </li>
            <li className="px-5 py-3">
              <strong className="font-semibold">Detailed Intelligence.</strong>{' '}
              The complete dashboard: levels, history, interpretation and the
              pricing sections of every report.
            </li>
            <li className="px-5 py-3">
              <strong className="font-semibold">Premium.</strong> Everything
              above, plus CSV export and the premium briefing.
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
