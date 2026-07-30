import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SaveOpportunityButton } from '@/components/opportunities/save-opportunity-button';
import {
  ButtonLink,
  Card,
  DataRow,
  LockedPanel,
  Meter,
  Pill,
  SampleDataBadge,
  ScoreBadge,
  SectionHeading,
} from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import {
  formatDate,
  formatDeadline,
  formatMoney,
  formatMoneyRange,
  titleCase,
} from '@/lib/format';
import { loadOpportunityDetail } from '@/lib/opportunities/query';
import { serializeOpportunity } from '@/lib/opportunities/serialize';
import type { ScoreClassification } from '@/lib/scoring/score';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('opportunity_previews')
    .select('title, teaser')
    .eq('slug', slug)
    .maybeSingle();

  if (!data) return { title: 'Record not found' };
  return {
    title: data.title,
    description: data.teaser,
    // Individual records are member content; they should not be indexed
    // (spec 24, "Do not index: private records").
    robots: { index: false, follow: false },
  };
}

/** Renders whatever shape the rich-text field holds as readable paragraphs. */
function renderRichText(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return value.split(/\n{2,}/).filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(renderRichText);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') return [record.text];
    if (Array.isArray(record.content)) return renderRichText(record.content);
  }
  return [];
}

export default async function OpportunityDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const record = await loadOpportunityDetail(supabase, slug);

  // Row-level security may have withheld the record. Fall back to the teaser
  // so a locked record still renders its upgrade prompt rather than a 404.
  if (!record) {
    const { data: preview } = await supabase
      .from('opportunity_previews')
      .select('*')
      .eq('slug', slug)
      .maybeSingle();

    if (!preview) notFound();

    return (
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <Pill>{titleCase(preview.category)}</Pill>
          {preview.is_sample ? <SampleDataBadge /> : null}
        </div>
        <h1 className="mt-3 text-2xl sm:text-3xl">{preview.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <ScoreBadge
            score={preview.score}
            classification={preview.score_classification as ScoreClassification}
          />
          <span className="text-sm text-ink-600">
            {preview.county_name ?? 'Georgia'} ·{' '}
            {formatDeadline(preview.closing_date)}
          </span>
        </div>
        <p className="mt-6 text-base leading-relaxed text-ink-700">
          {preview.teaser}
        </p>
        <div className="mt-8">
          <LockedPanel
            title="This record is above your current plan"
            message="You can see that it exists, what it scores and when it closes. The analysis, financial detail, eligibility rules and source link are included with a higher tier."
            sections={[
              'Executive summary',
              'Full analysis',
              'Financial overview',
              'Eligibility and property details',
              'Risk factors',
              'Recommended next action',
              'Source information',
            ]}
          />
        </div>
      </div>
    );
  }

  const opportunity = serializeOpportunity(record, viewer);
  const analysis = renderRichText(opportunity.fullAnalysis);
  const property = opportunity.propertyDetails as Record<string, unknown> | null;
  const funding = opportunity.fundingDetails as Record<string, unknown> | null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm text-ink-500">
        <ol className="flex flex-wrap items-center gap-2">
          <li>
            <Link href="/opportunities" className="hover:underline">
              Opportunities
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="font-medium text-ink-800">
            {titleCase(opportunity.category)}
          </li>
        </ol>
      </nav>

      <header>
        <div className="flex flex-wrap items-center gap-2">
          <Pill>{titleCase(opportunity.category)}</Pill>
          {opportunity.subtype ? <Pill tone="muted">{opportunity.subtype}</Pill> : null}
          {opportunity.isSample ? <SampleDataBadge /> : null}
          {opportunity.isExpired ? <Pill tone="muted">Closed</Pill> : null}
          {opportunity.isClosingSoon && !opportunity.isExpired ? (
            <Pill tone="warning">Closing soon</Pill>
          ) : null}
        </div>

        <h1 className="mt-3 text-2xl sm:text-3xl">{opportunity.title}</h1>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          <ScoreBadge
            score={opportunity.score}
            classification={opportunity.classification as ScoreClassification}
          />
          <span className="text-sm text-ink-600">
            {[opportunity.city, opportunity.county].filter(Boolean).join(', ') ||
              'Georgia'}
          </span>
          <span className="text-sm text-ink-600">
            {formatDeadline(opportunity.closingDate)}
          </span>
          <span className="text-sm text-ink-500">
            Verified {formatDate(opportunity.dateVerified)}
          </span>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <SaveOpportunityButton opportunityId={opportunity.id} />
          {opportunity.source?.url ? (
            <a
              href={opportunity.source.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex items-center rounded-lg border border-ink-300 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-ink-50"
            >
              View original source
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : null}
          <Link
            href={`/corrections/new?opportunity=${opportunity.id}`}
            className="inline-flex items-center rounded-lg px-4 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-100"
          >
            Report a correction
          </Link>
        </div>
      </header>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.7fr,1fr]">
        <div className="space-y-10">
          <section>
            <h2 className="text-xl">Executive summary</h2>
            <p className="prose-ledger mt-3">
              {opportunity.summary ?? opportunity.teaser}
            </p>
          </section>

          {analysis.length > 0 ? (
            <section>
              <h2 className="text-xl">Full analysis</h2>
              <div className="prose-ledger mt-3">
                {analysis.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </section>
          ) : null}

          {opportunity.access.detailLevel === 'complete' ? (
            <>
              {opportunity.eligibilitySummary ? (
                <section>
                  <h2 className="text-xl">Eligibility</h2>
                  <p className="prose-ledger mt-3">
                    {opportunity.eligibilitySummary}
                  </p>
                </section>
              ) : null}

              {property ? (
                <section>
                  <h2 className="text-xl">Property details</h2>
                  <dl className="mt-3 surface p-5">
                    <DataRow
                      label="Property type"
                      value={titleCase(String(property.property_type ?? '—'))}
                    />
                    <DataRow
                      label="Sale type"
                      value={titleCase(String(property.sale_type ?? '—'))}
                    />
                    <DataRow
                      label="Parcel number"
                      value={String(property.parcel_number ?? '—')}
                    />
                    <DataRow
                      label="Asking price"
                      value={formatMoney(property.asking_price as number | null)}
                    />
                    <DataRow
                      label="Starting bid"
                      value={formatMoney(property.starting_bid as number | null)}
                    />
                    <DataRow
                      label="Assessed value"
                      value={formatMoney(property.assessed_value as number | null)}
                    />
                    <DataRow
                      label="Building size"
                      value={
                        property.building_size_sqft
                          ? `${Number(property.building_size_sqft).toLocaleString('en-US')} sq ft`
                          : '—'
                      }
                    />
                    <DataRow
                      label="Lot size"
                      value={
                        property.lot_size_acres
                          ? `${Number(property.lot_size_acres).toLocaleString('en-US')} acres`
                          : '—'
                      }
                    />
                    <DataRow label="Zoning" value={String(property.zoning ?? '—')} />
                    <DataRow
                      label="Registration deadline"
                      value={formatDate(property.registration_deadline as string)}
                    />
                    <DataRow
                      label="Auction date"
                      value={formatDate(property.auction_date as string)}
                    />
                    <DataRow
                      label="Known liens"
                      value={String(property.known_liens ?? 'None recorded')}
                    />
                  </dl>
                </section>
              ) : null}

              {funding ? (
                <section>
                  <h2 className="text-xl">Program details</h2>
                  <dl className="mt-3 surface p-5">
                    <DataRow
                      label="Funding type"
                      value={titleCase(String(funding.funding_type ?? '—'))}
                    />
                    <DataRow
                      label="Administered by"
                      value={String(funding.funding_organization ?? '—')}
                    />
                    <DataRow
                      label="Award range"
                      value={formatMoneyRange(
                        funding.minimum_amount as number | null,
                        funding.maximum_amount as number | null,
                      )}
                    />
                    <DataRow
                      label="Owner contribution"
                      value={
                        funding.owner_contribution_percent
                          ? `${funding.owner_contribution_percent}%`
                          : '—'
                      }
                    />
                    <DataRow
                      label="Application complexity"
                      value={titleCase(
                        String(funding.application_complexity ?? 'moderate'),
                      )}
                    />
                    <DataRow
                      label="Decision timeline"
                      value={String(funding.estimated_decision_timeline ?? '—')}
                    />
                    <DataRow
                      label="Application deadline"
                      value={formatDate(funding.application_deadline as string)}
                    />
                  </dl>
                </section>
              ) : null}

              {opportunity.riskSummary ? (
                <section>
                  <h2 className="text-xl">Risk factors</h2>
                  <p className="prose-ledger mt-3">{opportunity.riskSummary}</p>
                </section>
              ) : null}

              {opportunity.restrictions ? (
                <section>
                  <h2 className="text-xl">Restrictions</h2>
                  <p className="prose-ledger mt-3">{opportunity.restrictions}</p>
                </section>
              ) : null}

              {opportunity.recommendedNextAction ? (
                <section className="rounded-xl border border-clay-200 bg-clay-50 p-5">
                  <h2 className="text-lg text-clay-900">
                    Recommended next action
                  </h2>
                  <p className="mt-2 text-[15px] leading-relaxed text-clay-900">
                    {opportunity.recommendedNextAction}
                  </p>
                </section>
              ) : null}
            </>
          ) : (
            <LockedPanel
              title="More of this record is available"
              message={opportunity.access.upgradeMessage}
              requiredPlan={opportunity.access.requiredPlan}
              sections={opportunity.access.lockedSections}
            />
          )}
        </div>

        <aside className="space-y-6">
          {opportunity.access.detailLevel !== 'preview' ? (
            <Card>
              <h2 className="text-base font-semibold">Financial overview</h2>
              <dl className="mt-3">
                <DataRow
                  label="Estimated value"
                  value={formatMoneyRange(
                    opportunity.estimatedValueMin,
                    opportunity.estimatedValueMax,
                  )}
                />
                <DataRow
                  label="Capital required"
                  value={formatMoneyRange(
                    opportunity.capitalRequiredMin,
                    opportunity.capitalRequiredMax,
                  )}
                />
                <DataRow
                  label="Deposit"
                  value={formatMoney(opportunity.depositRequired)}
                />
              </dl>
            </Card>
          ) : null}

          {opportunity.scoreBreakdown ? (
            <Card>
              <h2 className="text-base font-semibold">Why it scores {opportunity.score}</h2>
              <div className="mt-4 space-y-3">
                {opportunity.scoreBreakdown.map((row) => (
                  <Meter
                    key={row.key}
                    label={row.label}
                    value={row.awarded}
                    max={row.maximum}
                  />
                ))}
              </div>
              {opportunity.scoreExplanation ? (
                <p className="mt-4 border-t border-ink-100 pt-3 text-sm leading-relaxed text-ink-700">
                  {opportunity.scoreExplanation}
                </p>
              ) : null}
            </Card>
          ) : (
            <Card>
              <h2 className="text-base font-semibold">Score explanation</h2>
              <p className="mt-2 text-sm text-ink-600">
                The component-by-component breakdown is included with Detailed
                Intelligence.
              </p>
              <Link
                href="/pricing"
                className="mt-3 inline-block text-sm font-medium underline"
              >
                Compare plans
              </Link>
            </Card>
          )}

          <Card>
            <h2 className="text-base font-semibold">Timeline</h2>
            <dl className="mt-3">
              <DataRow label="Opens" value={formatDate(opportunity.openingDate)} />
              <DataRow label="Closes" value={formatDate(opportunity.closingDate)} />
              <DataRow
                label="Last verified"
                value={formatDate(opportunity.dateVerified)}
              />
              <DataRow
                label="Verification"
                value={titleCase(opportunity.verificationStatus)}
              />
            </dl>
          </Card>

          {opportunity.source ? (
            <Card>
              <h2 className="text-base font-semibold">Source</h2>
              <dl className="mt-3">
                <DataRow label="Source" value={opportunity.source.name ?? '—'} />
                <DataRow
                  label="Organisation"
                  value={opportunity.source.organization ?? '—'}
                />
                <DataRow
                  label="Reliability"
                  value={`${opportunity.source.reliabilityScore ?? '—'} / 15`}
                />
              </dl>
              {opportunity.source.url ? (
                <a
                  href={opportunity.source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="mt-3 inline-block break-all text-sm underline"
                >
                  {opportunity.source.url}
                </a>
              ) : null}
            </Card>
          ) : null}

          {viewer.planCode !== 'premium' && !viewer.isStaff ? (
            <Card className="bg-ink-900 text-white">
              <h2 className="text-base font-semibold text-white">
                Get told before the deadline
              </h2>
              <p className="mt-2 text-sm text-ink-200">
                Premium members are alerted the moment a matching record is
                published or materially changes.
              </p>
              <ButtonLink href="/pricing" variant="secondary" className="mt-4 w-full">
                Compare plans
              </ButtonLink>
            </Card>
          ) : null}
        </aside>
      </div>

      <SectionHeading
        title="Before you act"
        description="This record is research, not advice. Verify every figure against the original source, and take professional advice on title, tax and eligibility before you commit capital."
      />
    </div>
  );
}
