import type { Metadata } from 'next';

import { PlanGrid } from '@/components/pricing/plan-grid';
import { SectionHeading } from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { PLAN_FEATURE_DEFAULTS, type PlanCode } from '@/lib/access/ranks';
import { loadPlans } from '@/lib/public-data';

export const metadata: Metadata = {
  title: 'Membership plans',
  description:
    'Four membership tiers, from a free weekly preview to the complete ' +
    'property and funding database with immediate alerts and CSV export.',
  alternates: { canonical: '/pricing' },
};

const COMPARISON_ROWS: ReadonlyArray<{
  label: string;
  render: (code: PlanCode) => string;
}> = [
  {
    label: 'Opportunity detail',
    render: (code) =>
      ({
        preview: 'Preview only',
        summary: 'Summary',
        complete: 'Complete analysis',
      })[PLAN_FEATURE_DEFAULTS[code].opportunityDetail],
  },
  {
    label: 'Score explanation',
    render: (code) =>
      PLAN_FEATURE_DEFAULTS[code].opportunityDetail === 'complete'
        ? 'Yes'
        : 'No',
  },
  {
    label: 'Saved opportunities',
    render: (code) => {
      const limit = PLAN_FEATURE_DEFAULTS[code].savedOpportunityLimit;
      return limit === null ? 'Unlimited' : String(limit);
    },
  },
  {
    label: 'Saved searches',
    render: (code) => {
      const limit = PLAN_FEATURE_DEFAULTS[code].savedSearchLimit;
      if (limit === null) return 'Unlimited';
      return limit === 0 ? 'No' : String(limit);
    },
  },
  {
    label: 'Immediate alerts',
    render: (code) =>
      PLAN_FEATURE_DEFAULTS[code].immediateAlerts ? 'Yes' : 'No',
  },
  {
    label: 'CSV export',
    render: (code) => (PLAN_FEATURE_DEFAULTS[code].csvExport ? 'Yes' : 'No'),
  },
  {
    label: 'Weekly report',
    render: (code) =>
      PLAN_FEATURE_DEFAULTS[code].weeklyReports ? 'Yes' : 'Preview',
  },
  {
    label: 'Report archive',
    render: (code) =>
      PLAN_FEATURE_DEFAULTS[code].reportArchive === 'full'
        ? 'Full archive'
        : 'Recent only',
  },
  {
    label: 'Deadline calendar',
    render: (code) =>
      PLAN_FEATURE_DEFAULTS[code].deadlineCalendar ? 'Yes' : 'No',
  },
  {
    label: 'Pricing dashboard',
    render: (code) =>
      PLAN_FEATURE_DEFAULTS[code].pricingDashboard === 'complete'
        ? 'Complete'
        : 'Preview',
  },
  {
    label: 'Advanced filters',
    render: (code) =>
      PLAN_FEATURE_DEFAULTS[code].advancedFilters ? 'Yes' : 'No',
  },
  {
    label: 'Custom alert preferences',
    render: (code) =>
      PLAN_FEATURE_DEFAULTS[code].customAlertPreferences ? 'Yes' : 'No',
  },
  {
    label: 'Premium briefing',
    render: (code) =>
      PLAN_FEATURE_DEFAULTS[code].premiumBriefing ? 'Yes' : 'No',
  },
  {
    label: 'Results per page',
    render: (code) => String(PLAN_FEATURE_DEFAULTS[code].maxPageSize),
  },
];

const BILLING_FAQ = [
  {
    question: 'Can I change plans later?',
    answer:
      'Yes. Upgrades take effect immediately and are prorated, so you only pay ' +
      'the difference for the rest of the period. Downgrades take effect at the ' +
      'end of the period you have already paid for.',
  },
  {
    question: 'What happens if a payment fails?',
    answer:
      'We keep your access while the card is retried, plus a three-day grace ' +
      'period, and email you a link to update your payment method. After that ' +
      'the account returns to the free tier. Nothing you have saved is deleted.',
  },
  {
    question: 'Do you offer refunds?',
    answer:
      'Cancel any time and your access continues to the end of the period you ' +
      'have paid for. If something has gone wrong — a record we got badly ' +
      'wrong, a billing error — contact support and we will make it right.',
  },
  {
    question: 'Is my payment information stored here?',
    answer:
      'No. Checkout, card storage and invoices are handled entirely by Stripe. ' +
      'This application never receives a card number.',
  },
];

export default async function PricingPage() {
  const [plans, session] = await Promise.all([
    loadPlans(),
    getSessionContext(),
  ]);
  const codes: PlanCode[] = ['free', 'weekly', 'detailed', 'premium'];

  return (
    <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl sm:text-4xl">Membership plans</h1>
        <p className="mt-4 text-lg text-ink-700">
          Start free. Move up when the deadlines start mattering to you.
        </p>
      </div>

      <div className="mt-10">
        <PlanGrid
          plans={plans}
          isAuthenticated={session.viewer.isAuthenticated}
          currentPlanCode={session.planCode}
        />
      </div>

      <section className="mt-16">
        <SectionHeading
          title="Feature comparison"
          description="Every capability, per tier. These are the same limits the application enforces on the server."
        />
        <div className="surface overflow-x-auto">
          <table className="min-w-[720px] text-sm">
            <caption className="sr-only">
              Comparison of features across the four membership tiers
            </caption>
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50">
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  Feature
                </th>
                {codes.map((code) => (
                  <th
                    key={code}
                    scope="col"
                    className="px-4 py-3 text-left font-semibold capitalize"
                  >
                    {code === 'free'
                      ? 'Free'
                      : code === 'weekly'
                        ? 'Weekly'
                        : code === 'detailed'
                          ? 'Detailed'
                          : 'Premium'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr
                  key={row.label}
                  className="border-b border-ink-100 last:border-0"
                >
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {row.label}
                  </th>
                  {codes.map((code) => (
                    <td key={code} className="px-4 py-3 text-ink-700">
                      {row.render(code)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto mt-16 max-w-3xl">
        <SectionHeading title="Billing questions" />
        <dl className="divide-y divide-ink-200">
          {BILLING_FAQ.map((item) => (
            <div key={item.question} className="py-5">
              <dt className="font-semibold">{item.question}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-ink-700">
                {item.answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
