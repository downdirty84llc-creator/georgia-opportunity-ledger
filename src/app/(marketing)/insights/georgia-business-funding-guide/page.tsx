import type { Metadata } from 'next';

import { ButtonLink } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Three SBA funding routes for Georgia businesses',
  description:
    'A free comparison of SBA 7(a), 504 and Microloans, with original sources, key restrictions and application routes for Georgia business owners.',
  alternates: { canonical: '/insights/georgia-business-funding-guide' },
};

const PROGRAMS = [
  {
    name: '7(a): several business purposes',
    purpose:
      'SBA lists working capital, equipment, business ownership changes and eligible real-estate uses among the purposes of 7(a) loans. The maximum loan amount is $5 million.',
    restriction:
      'Applicants must meet SBA size and other eligibility rules, be creditworthy and demonstrate repayment ability. The program also has a credit-elsewhere requirement; a large maximum does not establish your eligibility.',
    route:
      'Apply through a participating lender. Ask the lender which documents and loan structure fit your proposed use.',
    url: 'https://www.sba.gov/loans/7a-loans/',
    source: 'SBA: 7(a) loans',
  },
  {
    name: '504: major fixed assets',
    purpose:
      'SBA describes 504 financing for eligible buildings, land and long-term equipment. Its detailed program section lists a maximum loan amount of $5.5 million; the amount available depends on the project and program rules.',
    restriction:
      '504 financing cannot fund working capital or inventory, or speculation or investment in rental real estate. Do not treat it as a general-purpose property investment loan.',
    route:
      'Start with an SBA Certified Development Company (CDC), which works with a senior lender on project financing. Confirm required owner contribution, eligible costs and total financing before committing to a purchase.',
    url: 'https://www.sba.gov/loans/504-loans/',
    source: 'SBA: 504 loans',
  },
  {
    name: 'Microloans: smaller financing needs',
    purpose:
      'The SBA Microloan program offers loans up to $50,000 through intermediary lenders. Listed uses include working capital, inventory, supplies and equipment.',
    restriction:
      'Proceeds cannot pay existing debts or buy real estate. An intermediary makes the credit decision and sets the loan terms; the program maximum is not a promised offer.',
    route:
      'Use the SBA directory linked from its program page to find an approved intermediary serving your area. Confirm current requirements and availability directly.',
    url: 'https://www.sba.gov/loans/microloans/',
    source: 'SBA: Microloans',
  },
] as const;

export default function GeorgiaFundingGuidePage() {
  return (
    <article className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <p className="text-sm font-semibold text-ink-600">Free research guide</p>
      <h1 className="mt-3 text-3xl sm:text-4xl">
        Three SBA funding routes for Georgia businesses
      </h1>
      <p className="mt-4 text-sm text-ink-600">
        Sources checked <time dateTime="2026-11-04">November 4, 2026</time>
      </p>
      <p className="mt-6 text-lg leading-relaxed text-ink-700">
        Start with the purpose of the financing: working capital, a business
        acquisition, equipment or premises. These federal loan programs are
        relevant to eligible Georgia businesses, but each has different limits
        and a different application route. They are loans that must be repaid.
      </p>
      <p className="mt-4 leading-relaxed text-ink-700">
        This is an introductory comparison, not a lender offer or an eligibility
        decision. Program availability, rates and terms must be confirmed with
        the lender. The source pages below govern if their information changes.
      </p>

      <div className="mt-10 space-y-6">
        {PROGRAMS.map((program) => (
          <section key={program.name} className="surface p-6 sm:p-8">
            <h2 className="text-2xl">{program.name}</h2>
            <p className="mt-4 leading-relaxed text-ink-700">
              {program.purpose}
            </p>
            <h3 className="mt-5 text-base font-semibold">
              Check before applying
            </h3>
            <p className="mt-2 leading-relaxed text-ink-700">
              {program.restriction}
            </p>
            <h3 className="mt-5 text-base font-semibold">Next step</h3>
            <p className="mt-2 leading-relaxed text-ink-700">{program.route}</p>
            <p className="mt-5 text-sm">
              <a
                className="font-semibold underline underline-offset-4"
                href={program.url}
              >
                {program.source}
              </a>
            </p>
          </section>
        ))}
      </div>

      <section className="mt-10" aria-labelledby="georgia-help">
        <h2 id="georgia-help" className="text-2xl">
          Prepare with a Georgia resource
        </h2>
        <p className="mt-4 leading-relaxed text-ink-700">
          UGA Small Business Development Center’s SSBCI team offers assistance
          with financial statements, projections and funding preparation. Its
          page also lists no-cost educational workshops. An advisory
          conversation can help you prepare; it does not constitute approval for
          a loan.
        </p>
        <p className="mt-4">
          <a
            className="font-semibold underline underline-offset-4"
            href="https://georgiasbdc.org/ssbci/"
          >
            UGA SBDC: SSBCI advisory services and workshops
          </a>
        </p>
      </section>

      <section className="mt-10" aria-labelledby="lender-questions">
        <h2 id="lender-questions" className="text-2xl">
          Questions to take to a lender
        </h2>
        <p className="mt-4 leading-relaxed text-ink-700">
          Use this research checklist to make the first conversation specific:
        </p>
        <ul className="mt-4 list-disc space-y-3 pl-6 text-ink-700">
          <li>
            Does my intended use qualify, and what evidence must I provide?
          </li>
          <li>
            What owner contribution, collateral or personal guarantee is
            required?
          </li>
          <li>
            What is the total borrowing cost, including fees, and can the rate
            change?
          </li>
          <li>
            What repayment schedule, application steps and timing should I
            expect?
          </li>
        </ul>
      </section>

      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href="/register">Create a free account</ButtonLink>
        <ButtonLink href="/funding" variant="secondary">
          Explore funding research
        </ButtonLink>
      </div>
      <p className="mt-6 text-sm text-ink-600">
        No affiliation with SBA, UGA SBDC or a lender is claimed. Georgia
        Opportunity Ledger is a research service.
      </p>
    </article>
  );
}
