import type { Metadata } from 'next';

import {
  ButtonLink,
  Card,
  Meter,
  SectionHeading,
} from '@/components/ui/primitives';
import { CLASSIFICATION_BANDS, SCORE_MAXIMA } from '@/lib/scoring/score';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'The sources we monitor, the editorial workflow every record passes ' +
    'through, and exactly how the 100-point opportunity score is calculated.',
  alternates: { canonical: '/how-it-works' },
};

const COMPONENTS: ReadonlyArray<{
  key: keyof typeof SCORE_MAXIMA;
  label: string;
  measures: string;
}> = [
  {
    key: 'financialValue',
    label: 'Financial value',
    measures:
      'Estimated direct value, savings potential, funding amount, acquisition discount and growth potential. Banded rather than linear, because the difference between a $2m and a $2.2m opportunity is noise.',
  },
  {
    key: 'accessibility',
    label: 'Accessibility',
    measures:
      'How many subscribers could realistically qualify. Deductions compound for geographic restriction, industry restriction, revenue floors, licensing requirements and owner contribution.',
  },
  {
    key: 'timeSensitivity',
    label: 'Time sensitivity',
    measures:
      'How close the deadline is, whether inventory is limited, and whether awards are first-come, first-served. A record with no deadline scores 3 — not urgent, but still actionable.',
  },
  {
    key: 'sourceReliability',
    label: 'Source reliability',
    measures:
      'A primary government source scores 15. An authorised official source scores 13, a licensed source 11, a verified secondary source 8, and an unverified lead 3 or lower.',
  },
  {
    key: 'capitalRequirement',
    label: 'Capital requirement',
    measures:
      'Lower required capital scores higher, because the component measures who can act. An unresearched requirement scores 5 — neutral — rather than 0.',
  },
  {
    key: 'complexity',
    label: 'Complexity',
    measures:
      'The application or acquisition burden. A one-page form and a fifty-page competitive grant are not the same opportunity.',
  },
  {
    key: 'risk',
    label: 'Risk',
    measures:
      'Title risk, redemption periods, clawback terms, program uncertainty. Lower risk scores higher.',
  },
];

const WORKFLOW = [
  {
    role: 'Researcher',
    can: 'Creates draft records, attaches sources and internal notes, submits for review.',
    cannot:
      'Cannot publish, cannot change a score, cannot change who may see a record.',
  },
  {
    role: 'Reviewer',
    can: 'Checks the record against its sources, approves or returns it with notes, sets the component scores and schedules publication.',
    cannot: 'Cannot publish.',
  },
  {
    role: 'Editor',
    can: 'Publishes approved records, builds and publishes reports, manages articles and editorial email.',
    cannot: 'Cannot alter the audit log — nobody can.',
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6">
      <h1 className="text-3xl sm:text-4xl">How the ledger works</h1>
      <p className="mt-5 text-lg leading-relaxed text-ink-700">
        Everything here is published so you can argue with it. A score you
        cannot interrogate is a number we are asking you to take on faith, and
        that is not what you are paying for.
      </p>

      <section className="mt-14">
        <SectionHeading
          eyebrow="Provenance"
          title="Where the information comes from"
        />
        <div className="prose-ledger max-w-none">
          <p>
            We monitor public and authorised sources only: state agencies such
            as the Georgia Department of Economic Development, the Department of
            Community Affairs, the Department of Administrative Services and the
            Department of Revenue; federal portals including Grants.gov, SAM.gov
            and GSA property disposal; county records; local development
            authorities; and economic data services such as the Bureau of Labor
            Statistics, FRED and the Census Bureau.
          </p>
          <p>
            Each source carries a recorded reliability rating, a check cadence,
            and the date it was last checked. We do not automate collection from
            any source until its terms of use have been read and the review
            outcome recorded — the database physically refuses to enable
            automated collection before that has happened.
          </p>
          <p>
            Every published record names its source and links to it. If our
            summary and the source disagree, the source is right, and we want to
            know: there is a correction form on every record.
          </p>
        </div>
      </section>

      <section className="mt-14">
        <SectionHeading
          eyebrow="Editorial workflow"
          title="Three people, three different jobs"
          description="Separation of duties is enforced by the software, not by convention. Nobody can draft, approve and publish the same record alone."
        />
        <div className="grid gap-5 sm:grid-cols-3">
          {WORKFLOW.map((stage) => (
            <Card key={stage.role} as="article">
              <h3 className="text-base font-semibold">{stage.role}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-700">
                {stage.can}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">
                {stage.cannot}
              </p>
            </Card>
          ))}
        </div>
        <p className="mt-5 text-sm text-ink-600">
          Publishing, unpublishing, score changes, access changes, subscription
          overrides, refunds, suspensions, role changes and deletions are all
          written to an append-only audit log. There is no interface — for
          anyone, at any permission level — that can edit or remove an entry.
        </p>
      </section>

      <section className="mt-14">
        <SectionHeading
          eyebrow="Scoring"
          title="The 100-point score, component by component"
          description="Seven weighted components. The weights are fixed so that scores are comparable across records and across weeks."
        />
        <div className="space-y-6">
          {COMPONENTS.map((component) => (
            <div key={component.key} className="surface p-5">
              <Meter
                label={component.label}
                value={SCORE_MAXIMA[component.key]}
                max={SCORE_MAXIMA[component.key]}
              />
              <p className="mt-3 text-sm leading-relaxed text-ink-700">
                {component.measures}
              </p>
            </div>
          ))}
        </div>

        <div className="surface mt-8 p-5">
          <h3 className="text-base font-semibold">Reviewer adjustment</h3>
          <p className="mt-2 text-sm leading-relaxed text-ink-700">
            A reviewer may move the calculated total by up to 25 points in
            either direction when judgement beats the formula. The adjustment is
            impossible to save without a written reason, the reason is shown to
            Detailed and Premium members alongside the score, and the change is
            audited.
          </p>
        </div>
      </section>

      <section className="mt-14">
        <SectionHeading eyebrow="Classification" title="What the bands mean" />
        <div className="surface overflow-x-auto">
          <table className="min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50">
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  Score
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  Classification
                </th>
                <th scope="col" className="px-4 py-3 text-left font-semibold">
                  What it means in practice
                </th>
              </tr>
            </thead>
            <tbody>
              {CLASSIFICATION_BANDS.map((band, index) => (
                <tr
                  key={band.classification}
                  className="border-b border-ink-100 last:border-0"
                >
                  <td className="px-4 py-3 font-medium tabular-nums">
                    {band.min}–{band.max}
                  </td>
                  <td className="px-4 py-3 font-medium">{band.label}</td>
                  <td className="px-4 py-3 text-ink-700">
                    {
                      [
                        'Act this week. High value, few barriers, a deadline that is close.',
                        'Worth building a file on. Strong on most components.',
                        'Look properly before committing time. Usually a trade-off somewhere.',
                        'Narrow. Excellent for the few it fits, irrelevant to everyone else.',
                        'Context, not an opportunity. Published because it changes how you read the others.',
                      ][index]
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-ink-600">
          A score ranks opportunities against each other. It is not a
          prediction, not a recommendation, and not a substitute for your own
          diligence or professional advice.
        </p>
      </section>

      <section className="mt-14">
        <SectionHeading eyebrow="Freshness" title="Verification and expiry" />
        <div className="prose-ledger max-w-none">
          <p>
            Every record carries the date it was last verified. Published
            records are reverified on a thirty-day cycle; anything past that is
            flagged for review before it stays in front of you.
          </p>
          <p>
            Deadline flags are recomputed daily, so a record that quietly lapses
            overnight is marked expired the next morning rather than sitting in
            search results looking live. Records that change materially —
            deadline moved, amount changed, eligibility rewritten, status
            reopened — generate a new version and can trigger an update alert.
          </p>
        </div>
      </section>

      <div className="mt-14 flex flex-wrap gap-3">
        <ButtonLink href="/pricing">See membership plans</ButtonLink>
        <ButtonLink href="/sample-report" variant="secondary">
          Read a sample report
        </ButtonLink>
        <ButtonLink href="/legal/editorial-standards" variant="secondary">
          Editorial standards
        </ButtonLink>
      </div>
    </div>
  );
}
