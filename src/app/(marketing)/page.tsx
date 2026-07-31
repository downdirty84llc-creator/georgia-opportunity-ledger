import Link from 'next/link';

import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import {
  ButtonLink,
  Card,
  Pill,
  SectionHeading,
  ScoreBadge,
} from '@/components/ui/primitives';
import { formatDeadline } from '@/lib/format';
import {
  loadIndicatorPreviews,
  loadPreviewOpportunities,
  loadPublicStats,
} from '@/lib/public-data';

export const revalidate = 300;

const CATEGORIES = [
  {
    title: 'Commercial Property',
    href: '/commercial-property',
    description:
      'Tax sales, sheriff sales, bank-owned inventory, development-authority ' +
      'sites and off-market indications — with the liens, zoning and ' +
      'registration deadlines attached.',
    points: [
      'Auction and registration dates',
      'Zoning and current use',
      'Known liens and title notes',
    ],
  },
  {
    title: 'Business Funding',
    href: '/funding',
    description:
      'Grants, guaranteed loans, tax credits, workforce funding and ' +
      'procurement — sorted by who can actually qualify, not by who shouts ' +
      'loudest.',
    points: [
      'Eligibility in plain language',
      'Owner contribution and collateral',
      'Real application deadlines',
    ],
  },
  {
    title: 'Market Pricing',
    href: '/pricing-reports',
    description:
      'Construction inputs, industrial rents, vacancy, lending rates and ' +
      'permit activity — the numbers that decide whether a deal still works.',
    points: [
      'Month-over-month movement',
      'Named public sources',
      'Interpretation, not just a chart',
    ],
  },
];

const PROCESS = [
  {
    step: '01',
    title: 'Sources monitored',
    body:
      'We track named public bodies — state agencies, development authorities, ' +
      'federal portals and economic data services — on a schedule, and record ' +
      'when each was last checked.',
  },
  {
    step: '02',
    title: 'Opportunities verified',
    body:
      'Every record is traced to a primary source and carries the date it was ' +
      'verified. Anything older than thirty days is flagged for reverification ' +
      'before it stays in front of you.',
  },
  {
    step: '03',
    title: 'Records analysed',
    body:
      'A researcher writes the analysis, a reviewer checks it and scores it ' +
      'across seven weighted components, and an editor publishes it. No record ' +
      'reaches you without all three.',
  },
  {
    step: '04',
    title: 'Subscribers alerted',
    body:
      'Premium members are alerted the moment a matching record is published ' +
      'or materially changes. Everyone gets the weekly report and deadline ' +
      'reminders at fourteen, seven and two days.',
  },
];

const FAQ = [
  {
    question: 'Where does the information come from?',
    answer:
      'Public and authorised sources only: state agencies such as the Georgia ' +
      'Department of Economic Development and the Department of Community ' +
      'Affairs, federal portals including Grants.gov and SAM.gov, county ' +
      'records, development authorities, and economic data services such as ' +
      'the Bureau of Labor Statistics and FRED. Every published record names ' +
      'its source and links to it.',
  },
  {
    question: 'How often is it updated?',
    answer:
      'Continuously. Sources are checked on a per-source cadence, the weekly ' +
      'report is published every Thursday, and deadline flags are recomputed ' +
      'daily. Published records are reverified on a thirty-day cycle.',
  },
  {
    question: 'Do you give investment advice?',
    answer:
      'No. The Ledger is research and decision support. We are not a broker, a ' +
      'lender, an investment adviser, a law firm or an appraiser, and we do ' +
      'not guarantee eligibility, financing or performance. Scores rank ' +
      'opportunities against each other; they are not predictions.',
  },
  {
    question: 'How does cancellation work?',
    answer:
      'Cancel any time from the billing portal. Your access continues to the ' +
      'end of the period you have already paid for, then the account returns ' +
      'to the free tier. Everything you have saved stays in your account.',
  },
  {
    question: 'What does Premium include?',
    answer:
      'The complete property and funding database, immediate alerts when a ' +
      'matching record is published or changes materially, unlimited saved ' +
      'searches, CSV export, detailed alert preferences and the premium ' +
      'briefing.',
  },
];

export default async function HomePage() {
  const [stats, featured, closingSoon, indicators] = await Promise.all([
    loadPublicStats(),
    loadPreviewOpportunities({ limit: 6 }),
    loadPreviewOpportunities({ limit: 3, closingSoon: true }),
    loadIndicatorPreviews(4),
  ]);

  return (
    <>
      {/* --- Hero ------------------------------------------------------- */}
      <section className="border-b border-ink-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div className="max-w-xl">
            <Pill>Georgia · commercial property, funding and pricing</Pill>
            <h1 className="mt-4 text-3xl leading-tight sm:text-4xl lg:text-5xl">
              The opportunities are public. Finding them in time is the hard
              part.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-ink-700">
              We monitor the agencies, authorities and public records that
              publish Georgia&rsquo;s commercial property and business funding
              opportunities, verify what we find, score it, and put the deadline
              in your calendar before it passes.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href="/pricing">See membership plans</ButtonLink>
              <ButtonLink href="/sample-report" variant="secondary">
                Read a sample report
              </ButtonLink>
            </div>
            <p className="mt-5 text-sm text-ink-500">
              Every record names its source and the date we last verified it. No
              scraped listings, no recycled press releases, no guarantees we
              cannot keep.
            </p>
          </div>

          {/* Dashboard preview */}
          <div className="lg:pl-8">
            <div className="surface overflow-hidden">
              <div className="border-b border-ink-200 bg-ink-50 px-5 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
                  Member dashboard
                </p>
              </div>
              <div className="space-y-4 p-5">
                {featured[0] ? (
                  <div className="rounded-lg border border-ink-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold leading-snug">
                        {featured[0].title}
                      </p>
                      <ScoreBadge
                        score={featured[0].score}
                        classification={featured[0].classification}
                        size="sm"
                      />
                    </div>
                    <p className="mt-2 text-xs text-ink-600">
                      {featured[0].county ?? 'Georgia'} ·{' '}
                      {formatDeadline(featured[0].closingDate)}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-ink-300 p-4 text-sm text-ink-500">
                    Opportunity cards appear here once records are published.
                  </div>
                )}

                <div className="rounded-lg border border-ink-200 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Closing soon
                  </p>
                  <ul className="mt-2 space-y-2">
                    {closingSoon.length > 0 ? (
                      closingSoon.map((item) => (
                        <li
                          key={item.id}
                          className="flex items-baseline justify-between gap-3 text-sm"
                        >
                          <span className="truncate">{item.title}</span>
                          <span className="shrink-0 text-xs text-ink-500">
                            {formatDeadline(item.closingDate)}
                          </span>
                        </li>
                      ))
                    ) : (
                      <li className="text-sm text-ink-500">
                        Nothing closing in the next fortnight.
                      </li>
                    )}
                  </ul>
                </div>

                <div className="rounded-lg border border-ink-200 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                    Market pulse
                  </p>
                  <ul className="mt-2 space-y-1.5">
                    {indicators.map((indicator) => (
                      <li
                        key={indicator.id}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="truncate">{indicator.name}</span>
                        <span className="shrink-0 text-xs font-medium text-ink-600">
                          {indicator.percentChange === null
                            ? '—'
                            : `${indicator.percentChange > 0 ? '+' : ''}${indicator.percentChange.toFixed(1)}%`}
                        </span>
                      </li>
                    ))}
                    {indicators.length === 0 ? (
                      <li className="text-sm text-ink-500">
                        Indicators appear here once data is loaded.
                      </li>
                    ) : null}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* --- Statistics -------------------------------------------------- */}
      <section
        aria-label="Coverage at a glance"
        className="border-b border-ink-200 bg-ink-900 text-white"
      >
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-8 sm:px-6 lg:grid-cols-4">
          {[
            { label: 'Active opportunities', value: stats.activeOpportunities },
            { label: 'Georgia counties covered', value: stats.countiesCovered },
            {
              label: 'Records verified this week',
              value: stats.verifiedThisWeek,
            },
            {
              label: 'Deadlines in the next 14 days',
              value: stats.upcomingDeadlines,
            },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-3xl font-semibold tabular-nums">
                {stat.value}
              </p>
              <p className="mt-1 text-sm text-ink-300">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* --- Categories -------------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <SectionHeading
          eyebrow="What we track"
          title="Three kinds of intelligence, one ledger"
          description="Each category has its own fields, its own sources and its own scoring emphasis, because a tax sale and a workforce grant are not the same decision."
        />
        <div className="grid gap-5 lg:grid-cols-3">
          {CATEGORIES.map((category) => (
            <Card key={category.href} as="article" className="flex flex-col">
              <h3 className="text-lg font-semibold">{category.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-700">
                {category.description}
              </p>
              <ul className="mt-4 space-y-1.5 text-sm text-ink-600">
                {category.points.map((point) => (
                  <li key={point} className="flex gap-2">
                    <span aria-hidden="true" className="text-ink-400">
                      —
                    </span>
                    {point}
                  </li>
                ))}
              </ul>
              <Link
                href={category.href}
                className="mt-5 text-sm font-semibold text-ink-900 underline underline-offset-4"
              >
                Explore {category.title.toLowerCase()}
              </Link>
            </Card>
          ))}
        </div>
      </section>

      {/* --- Example opportunities --------------------------------------- */}
      {featured.length > 0 ? (
        <section className="border-y border-ink-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
            <SectionHeading
              eyebrow="From the current ledger"
              title="What a record looks like"
              description="These are live previews. Members see the full analysis, financial detail, eligibility rules and the source link."
              action={
                <ButtonLink href="/opportunities" variant="secondary">
                  Browse all opportunities
                </ButtonLink>
              }
            />
            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {featured.map((opportunity) => (
                <OpportunityCard
                  key={opportunity.id}
                  opportunity={{ ...opportunity, isLocked: true }}
                />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* --- How it works ------------------------------------------------ */}
      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <SectionHeading
          eyebrow="How it works"
          title="Four steps, and a name against every one of them"
          description="The workflow is deliberately slow in the middle. Speed matters at the deadline, not at the point where someone decides a record is true."
        />
        <ol className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {PROCESS.map((item) => (
            <li key={item.step} className="surface p-5">
              <p className="font-mono text-xs font-semibold text-clay-700">
                {item.step}
              </p>
              <h3 className="mt-2 text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">
                {item.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* --- Sample report ----------------------------------------------- */}
      <section className="border-y border-ink-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr,1fr]">
          <div>
            <SectionHeading
              eyebrow="The weekly report"
              title="One email, everything that moved"
              description="Published every Thursday. Personalised to your counties and industries, with the deadline calendar and the pricing indicators that changed."
            />
            <ul className="space-y-3 text-sm text-ink-700">
              <li>
                <strong className="font-semibold text-ink-900">
                  Executive summary.
                </strong>{' '}
                What changed this week and what it means for someone deciding
                where to put capital.
              </li>
              <li>
                <strong className="font-semibold text-ink-900">
                  Scored records.
                </strong>{' '}
                Ranked, with the reasoning shown rather than asserted.
              </li>
              <li>
                <strong className="font-semibold text-ink-900">
                  Deadline calendar.
                </strong>{' '}
                Everything closing in the next fortnight, exportable to your own
                calendar.
              </li>
            </ul>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/sample-report">
                View a sample report
              </ButtonLink>
              <ButtonLink href="/insights" variant="secondary">
                Free insights
              </ButtonLink>
            </div>
          </div>

          <div className="surface p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
              This week&rsquo;s pulse
            </p>
            {indicators.length === 0 ? (
              <p className="mt-4 text-sm text-ink-500">
                Pricing indicators appear here once observations are loaded.
              </p>
            ) : (
              <dl className="mt-4 space-y-3">
                {indicators.map((indicator) => (
                  <div
                    key={indicator.id}
                    className="flex items-baseline justify-between gap-4 border-b border-ink-100 pb-3 last:border-0"
                  >
                    <dt className="text-sm text-ink-700">{indicator.name}</dt>
                    <dd className="text-right">
                      <span className="text-sm font-semibold tabular-nums">
                        {indicator.percentChange === null
                          ? '—'
                          : `${indicator.percentChange > 0 ? '+' : ''}${indicator.percentChange.toFixed(1)}%`}
                      </span>
                      <span className="block text-xs text-ink-500">
                        {indicator.scope}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      </section>

      {/* --- FAQ ---------------------------------------------------------- */}
      <section className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
        <SectionHeading eyebrow="Questions" title="Before you subscribe" />
        <dl className="divide-y divide-ink-200">
          {FAQ.map((item) => (
            <div key={item.question} className="py-5">
              <dt className="text-base font-semibold">{item.question}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-ink-700">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/pricing">Compare membership plans</ButtonLink>
          <ButtonLink href="/register" variant="secondary">
            Start with the free tier
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
