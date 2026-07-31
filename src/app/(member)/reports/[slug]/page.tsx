import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ButtonLink,
  LockedPanel,
  Pill,
  ScoreBadge,
} from '@/components/ui/primitives';
import { canViewReport } from '@/lib/access/entitlements';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, formatDeadline, titleCase } from '@/lib/format';
import type { ScoreClassification } from '@/lib/scoring/score';

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('report_previews')
    .select('title')
    .eq('slug', slug)
    .maybeSingle();
  return {
    title: data?.title ?? 'Report',
    robots: { index: false, follow: false },
  };
}

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

export default async function ReportPage({ params }: PageProps) {
  const { slug } = await params;
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const { data: header } = await supabase
    .from('report_previews')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!header) notFound();

  const decision = canViewReport(viewer, {
    minimumAccessRank: header.minimum_access_rank,
    isSample: header.is_sample,
    status: 'published',
  });

  if (!decision.allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl sm:text-3xl">{header.title}</h1>
        <p className="mt-2 text-sm text-ink-600">
          Published {formatDate(header.published_at)}
        </p>
        <div className="mt-8">
          <LockedPanel
            title="This report is above your current plan"
            message={decision.message}
            requiredPlan={decision.requiredPlan}
            sections={[
              'Executive summary',
              'Market commentary',
              'Scored records with editor commentary',
              'Deadline calendar',
              'Pricing appendix',
            ]}
          />
        </div>
      </div>
    );
  }

  const { data: report } = await supabase
    .from('reports')
    .select(
      `id, title, slug, report_type, reporting_period_start,
       reporting_period_end, executive_summary, market_commentary,
       published_at, pdf_file_path, is_sample,
       report_sections ( id, section_type, title, content, display_order,
                         minimum_access_rank ),
       report_opportunities ( display_order, editor_commentary,
                              minimum_access_rank,
                              opportunities ( id, slug, title, score,
                                              score_classification,
                                              closing_date, category ) )`,
    )
    .eq('slug', slug)
    .maybeSingle();

  if (!report) notFound();

  const sections = (report.report_sections ?? [])
    .slice()
    .sort((a, b) => a.display_order - b.display_order);
  const entries = (report.report_opportunities ?? [])
    .slice()
    .sort((a, b) => a.display_order - b.display_order);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="muted">{titleCase(report.report_type)}</Pill>
        {report.is_sample ? <Pill>Sample</Pill> : null}
      </div>
      <h1 className="mt-3 text-2xl sm:text-3xl">{report.title}</h1>
      <p className="mt-2 text-sm text-ink-600">
        {report.reporting_period_start && report.reporting_period_end
          ? `${formatDate(report.reporting_period_start)} – ${formatDate(report.reporting_period_end)}`
          : `Published ${formatDate(report.published_at)}`}
      </p>

      {report.executive_summary ? (
        <section className="mt-10">
          <h2 className="text-xl">Executive summary</h2>
          <div className="prose-ledger mt-3">
            {renderRichText(report.executive_summary).map(
              (paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ),
            )}
          </div>
        </section>
      ) : null}

      {report.market_commentary ? (
        <section className="mt-10">
          <h2 className="text-xl">Market commentary</h2>
          <div className="prose-ledger mt-3">
            {renderRichText(report.market_commentary).map(
              (paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ),
            )}
          </div>
        </section>
      ) : null}

      {sections.map((section) => {
        const unlocked =
          viewer.isStaff || viewer.accessRank >= section.minimum_access_rank;
        return (
          <section key={section.id} className="mt-10">
            <h2 className="text-xl">{section.title}</h2>
            {unlocked ? (
              <div className="prose-ledger mt-3">
                {renderRichText(section.content).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            ) : (
              <div className="mt-3">
                <LockedPanel
                  title={`${section.title} is included with a higher tier`}
                  message="This section of the report is available to members on a higher plan."
                />
              </div>
            )}
          </section>
        );
      })}

      {entries.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-xl">Records in this report</h2>
          <ul className="mt-4 space-y-3">
            {entries.map((entry) => {
              const opportunity = Array.isArray(entry.opportunities)
                ? entry.opportunities[0]
                : entry.opportunities;
              if (!opportunity) return null;
              const unlocked =
                viewer.isStaff ||
                viewer.accessRank >= entry.minimum_access_rank;

              return (
                <li key={opportunity.id} className="surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/opportunities/${opportunity.slug}`}
                        className="font-semibold hover:underline"
                      >
                        {opportunity.title}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {titleCase(opportunity.category)} ·{' '}
                        {formatDeadline(opportunity.closing_date)}
                      </p>
                    </div>
                    <ScoreBadge
                      score={opportunity.score}
                      classification={
                        opportunity.score_classification as ScoreClassification
                      }
                      size="sm"
                    />
                  </div>
                  {unlocked && entry.editor_commentary ? (
                    <p className="mt-3 border-t border-ink-100 pt-3 text-sm leading-relaxed text-ink-700">
                      {entry.editor_commentary}
                    </p>
                  ) : null}
                  {!unlocked ? (
                    <p className="mt-3 border-t border-ink-100 pt-3 text-sm text-ink-500">
                      Editor commentary on this record is included with a higher
                      tier.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <footer className="mt-12 border-t border-ink-200 pt-6">
        <p className="text-sm text-ink-500">
          This report is research and decision support. It is not investment,
          legal, brokerage or appraisal advice. Verify every figure against the
          original source before acting.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href="/reports" variant="secondary">
            All reports
          </ButtonLink>
          <ButtonLink
            href={`/corrections/new?report=${report.id}`}
            variant="ghost"
          >
            Report a correction
          </ButtonLink>
        </div>
      </footer>
    </article>
  );
}
