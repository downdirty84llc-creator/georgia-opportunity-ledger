import type { Metadata } from 'next';
import Link from 'next/link';

import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import { ButtonLink, Card, SectionHeading } from '@/components/ui/primitives';
import {
  loadCountiesWithCounts,
  loadPreviewOpportunities,
} from '@/lib/public-data';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Commercial property intelligence',
  description:
    'Tax sales, sheriff sales, bank-owned inventory, development-authority ' +
    'sites and distressed commercial property across Georgia — verified, ' +
    'scored and tracked to the registration deadline.',
  alternates: { canonical: '/commercial-property' },
};

const PROPERTY_CATEGORIES = [
  {
    name: 'Industrial and warehouse',
    body: 'Distribution, cold storage, flex and manufacturing space, including sites near the ports and the inland terminals.',
  },
  {
    name: 'Retail and office',
    body: 'Vacant anchors, small-bay retail, medical office and converted downtown stock.',
  },
  {
    name: 'Land and development',
    body: 'Assembled parcels, development-authority sites, and land with existing zoning or utility capacity.',
  },
  {
    name: 'Distressed and auction',
    body: 'Tax sales, sheriff sales, foreclosure, bank-owned and government disposal, with the registration rules attached.',
  },
];

const DUE_DILIGENCE = [
  'Confirm the parcel number and legal description against the county record before you bid.',
  'Tax and sheriff sales carry redemption periods and can convey encumbered title. Take advice.',
  'Registration deadlines and deposit requirements are frequently earlier and stricter than the sale date suggests.',
  'Zoning shown here is the zoning of record. It is not a permit, and it is not a guarantee of permitted use.',
  'Assessed value is a tax figure, not an appraisal, and rarely equals market value.',
];

export default async function CommercialPropertyPage() {
  const [samples, counties] = await Promise.all([
    loadPreviewOpportunities({ limit: 6, category: 'commercial_property' }),
    loadCountiesWithCounts(),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl sm:text-4xl">
          Commercial property, with the paperwork read
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-700">
          Georgia&rsquo;s commercial property opportunities are public, but they
          are scattered across 159 county records, a dozen state and federal
          disposal programs, and development authorities that publish on their
          own schedule. We watch them, verify what we find, and put the
          registration deadline in front of you while there is still time to act
          on it.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <ButtonLink href="/pricing">See membership plans</ButtonLink>
          <ButtonLink
            href="/opportunities?category=commercial_property"
            variant="secondary"
          >
            Browse property records
          </ButtonLink>
        </div>
      </div>

      <section className="mt-14">
        <SectionHeading
          eyebrow="Categories"
          title="What we cover"
          description="Every property record carries the fields that decide whether it is worth a site visit: parcel, zoning, current use, known liens, deposit, and the dates that actually bind."
        />
        <div className="grid gap-5 sm:grid-cols-2">
          {PROPERTY_CATEGORIES.map((category) => (
            <Card key={category.name} as="article">
              <h3 className="text-base font-semibold">{category.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">
                {category.body}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {samples.length > 0 ? (
        <section className="mt-14">
          <SectionHeading
            eyebrow="Current records"
            title="Sample property records"
            description="Previews. Members see the financial detail, the liens and title notes, and the source link."
          />
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {samples.map((opportunity) => (
              <OpportunityCard
                key={opportunity.id}
                opportunity={{ ...opportunity, isLocked: true }}
              />
            ))}
          </div>
        </section>
      ) : null}

      {counties.length > 0 ? (
        <section className="mt-14">
          <SectionHeading
            eyebrow="Coverage"
            title="County coverage"
            description="Counties with published records right now. Every Georgia county is in the database; coverage deepens as sources are reviewed."
          />
          <ul className="flex flex-wrap gap-2">
            {counties.slice(0, 40).map((county) => (
              <li key={county.slug}>
                <Link
                  href={`/georgia/${county.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-700 hover:border-ink-400"
                >
                  {county.name}
                  <span className="text-xs tabular-nums text-ink-500">
                    {county.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-14">
        <SectionHeading
          eyebrow="Before you bid"
          title="Due diligence is yours"
          description="We are not a brokerage, a title company or an appraiser. What we publish is a starting point for your own diligence, never a substitute for it."
        />
        <ul className="surface divide-y divide-ink-100">
          {DUE_DILIGENCE.map((item) => (
            <li
              key={item}
              className="px-5 py-4 text-sm leading-relaxed text-ink-700"
            >
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14 rounded-xl bg-ink-900 px-6 py-10 text-white sm:px-10">
        <h2 className="text-2xl text-white">
          Property records are included from Weekly upward
        </h2>
        <p className="mt-3 max-w-2xl text-ink-200">
          Weekly members get summaries and the deadline calendar. Detailed adds
          the full analysis, the score explanation and the pricing dashboard.
          Premium adds immediate alerts, saved searches and CSV export.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <ButtonLink href="/pricing" variant="secondary">
            Compare plans
          </ButtonLink>
          <ButtonLink
            href="/sample-report"
            variant="ghost"
            className="text-white hover:bg-ink-800"
          >
            Read a sample report
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
