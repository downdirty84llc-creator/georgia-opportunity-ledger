import type { Metadata } from 'next';

import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import { ButtonLink, Card, SectionHeading } from '@/components/ui/primitives';
import { formatDeadline } from '@/lib/format';
import { loadPreviewOpportunities } from '@/lib/public-data';

export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Business funding intelligence',
  description:
    'Grants, guaranteed loans, tax credits, workforce funding and procurement ' +
    'opportunities for Georgia businesses — with eligibility in plain language ' +
    'and the real application deadline.',
  alternates: { canonical: '/funding' },
};

const GRANT_VS_LOAN = [
  {
    title: 'Grants',
    body: 'Money you do not repay, awarded against a published set of criteria. Competitive, slow, and usually attached to an outcome you must evidence afterwards — job creation, capital investment, a location, a hiring commitment.',
    watch:
      'Reporting obligations and clawback terms. A grant with a five-year job commitment is a contract, not a gift.',
  },
  {
    title: 'Loans and guarantees',
    body: 'Money you repay, sometimes at a rate you would not get commercially because a public body carries part of the risk. Faster than grants, and available far more often.',
    watch:
      'Owner contribution, personal guarantees and collateral. The headline rate is rarely the whole cost.',
  },
  {
    title: 'Tax credits and incentives',
    body: 'Value delivered through your tax position rather than as cash — job tax credits, investment credits, port activity credits, freeport exemptions.',
    watch:
      'They are worth nothing without the tax liability to offset, and the filing deadline is often the binding one.',
  },
  {
    title: 'Procurement',
    body: 'Contracts to supply a public body. Not funding in the strict sense, but for many businesses the largest single opportunity on this list.',
    watch:
      'Registration, certification and bonding requirements usually take longer than the bid window.',
  },
];

const ELIGIBILITY_EXAMPLES = [
  'Minimum time in business, commonly two years of filed returns',
  'Revenue floors and ceilings, sometimes both on the same program',
  'Employee headcount, measured as full-time equivalents rather than heads',
  'Location inside a specific county, opportunity zone or development district',
  'Industry restrictions by NAICS code',
  'Owner contribution, frequently ten to twenty per cent of project cost',
];

export default async function FundingPage() {
  const [samples, closingSoon] = await Promise.all([
    loadPreviewOpportunities({ limit: 6, category: 'business_funding' }),
    loadPreviewOpportunities({ limit: 5, closingSoon: true }),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-3xl sm:text-4xl">
          Funding you can actually qualify for
        </h1>
        <p className="mt-5 text-lg leading-relaxed text-ink-700">
          There is more public money available to Georgia businesses than most
          owners realise, and most of it goes unclaimed because the programs are
          scattered, the eligibility rules are buried, and the deadlines pass
          quietly. We read the rules and tell you, in a sentence, whether this
          is for you.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <ButtonLink href="/pricing">See membership plans</ButtonLink>
          <ButtonLink href="/opportunities?category=business_funding" variant="secondary">
            Browse funding records
          </ButtonLink>
        </div>
      </div>

      <section className="mt-14">
        <SectionHeading
          eyebrow="Know the difference"
          title="Grants, loans, credits and contracts"
          description="Four different instruments with four different failure modes. The scoring weights accessibility heavily precisely because the most generous program is worthless if you cannot qualify."
        />
        <div className="grid gap-5 sm:grid-cols-2">
          {GRANT_VS_LOAN.map((item) => (
            <Card key={item.title} as="article">
              <h3 className="text-base font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">
                {item.body}
              </p>
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong className="font-semibold">Watch for:</strong> {item.watch}
              </p>
            </Card>
          ))}
        </div>
      </section>

      {samples.length > 0 ? (
        <section className="mt-14">
          <SectionHeading
            eyebrow="Current records"
            title="Sample funding programs"
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

      <div className="mt-14 grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHeading
            eyebrow="Eligibility"
            title="What actually decides it"
            description="Every funding record states these in plain language before you spend an hour on an application."
          />
          <ul className="surface divide-y divide-ink-100">
            {ELIGIBILITY_EXAMPLES.map((item) => (
              <li key={item} className="px-5 py-3 text-sm text-ink-700">
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <SectionHeading
            eyebrow="Deadlines"
            title="Closing soon"
            description="Deadline pressure is a scored component, not a marketing device. First-come-first-served programs score higher because they genuinely run out."
          />
          {closingSoon.length > 0 ? (
            <ul className="surface divide-y divide-ink-100">
              {closingSoon.map((item) => (
                <li key={item.id} className="px-5 py-3">
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {item.county ?? 'Georgia'} · {formatDeadline(item.closingDate)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="surface px-5 py-6 text-sm text-ink-600">
              Nothing is closing in the next fortnight. Deadlines appear here as
              records are published.
            </p>
          )}
        </section>
      </div>

      <section className="mt-14 rounded-xl bg-ink-900 px-6 py-10 text-white sm:px-10">
        <h2 className="text-2xl text-white">Do not miss a deadline again</h2>
        <p className="mt-3 max-w-2xl text-ink-200">
          Premium members are alerted the moment a matching program is published
          or materially changes. Everyone gets reminders at fourteen, seven and
          two days before a deadline they are tracking.
        </p>
        <div className="mt-6">
          <ButtonLink href="/pricing" variant="secondary">
            Compare plans
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
