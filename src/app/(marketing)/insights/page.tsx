import type { Metadata } from 'next';

import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import { ButtonLink, SectionHeading } from '@/components/ui/primitives';
import {
  loadIndicatorPreviews,
  loadPreviewOpportunities,
} from '@/lib/public-data';

export const revalidate = 900;

export const metadata: Metadata = {
  title: 'Free insights',
  description:
    'A rotating selection of current Georgia opportunity previews and market ' +
    'movement, free to read.',
  alternates: { canonical: '/insights' },
};

export default async function InsightsPage() {
  const [previews, indicators] = await Promise.all([
    loadPreviewOpportunities({ limit: 9 }),
    loadIndicatorPreviews(8),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl sm:text-4xl">Free insights</h1>
        <p className="mt-4 text-lg leading-relaxed text-ink-700">
          A standing, free window into the ledger: what is currently published,
          what it scores, and which way the market inputs are moving. The
          analysis behind each record is what membership buys.
        </p>
      </div>

      {previews.length > 0 ? (
        <section className="mt-12">
          <SectionHeading
            eyebrow="Current previews"
            title="On the ledger right now"
          />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {previews.map((opportunity) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={{ ...opportunity, isLocked: true }}
              />
            ))}
          </div>
        </section>
      ) : (
        <p className="surface mt-12 px-5 py-8 text-sm text-ink-600">
          Previews appear here as records are published.
        </p>
      )}

      <section className="mt-12">
        <SectionHeading eyebrow="Market movement" title="Direction of travel" />
        {indicators.length === 0 ? (
          <p className="surface px-5 py-6 text-sm text-ink-600">
            Indicators appear here once observations are loaded.
          </p>
        ) : (
          <dl className="surface divide-y divide-ink-100">
            {indicators.map((indicator) => (
              <div
                key={indicator.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3"
              >
                <dt className="text-sm">{indicator.name}</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {indicator.percentChange === null
                    ? '—'
                    : `${indicator.percentChange > 0 ? '+' : ''}${indicator.percentChange.toFixed(1)}%`}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <ButtonLink href="/register">Create a free account</ButtonLink>
        <ButtonLink href="/sample-report" variant="secondary">
          Read a sample report
        </ButtonLink>
      </div>
    </div>
  );
}
