import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { AttachmentsPanel } from '@/components/admin/attachments-panel';
import {
  ReportBuilder,
  type CandidateRecord,
  type ReportEntryDraft,
  type ReportSectionDraft,
} from '@/components/admin/report-builder';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import type { ScoreClassification } from '@/lib/scoring/score';

export const metadata: Metadata = { title: 'Compose report' };
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

function textOf(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

export default async function ComposeReportPage({ params }: PageProps) {
  const { id } = await params;
  const { viewer } = await getSessionContext();

  // Composing is an editor capability; other staff can read the report list but
  // not rewrite a report's contents.
  if (!['editor', 'super_administrator'].includes(viewer.role)) {
    redirect('/admin/reports');
  }

  const supabase = await createServerSupabaseClient();

  const [report, candidates] = await Promise.all([
    supabase
      .from('reports')
      .select(
        `id, slug, title, report_type, status, minimum_access_rank,
         reporting_period_start, reporting_period_end, executive_summary,
         market_commentary, scheduled_at, pdf_file_path,
         report_sections ( section_type, title, content, display_order,
                           minimum_access_rank ),
         report_opportunities ( opportunity_id, editor_commentary,
                                display_order, minimum_access_rank )`,
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('opportunities')
      .select(
        `id, title, category, score, score_classification, closing_date,
         minimum_access_rank, counties ( name )`,
      )
      .eq('workflow_status', 'published')
      .eq('is_restricted', false)
      .order('score', { ascending: false })
      .limit(200),
  ]);

  if (!report.data) notFound();

  const sections: ReportSectionDraft[] = (report.data.report_sections ?? [])
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .map((section) => ({
      sectionType: section.section_type,
      title: section.title,
      content: textOf(section.content),
      minimumAccessRank: section.minimum_access_rank,
    }));

  const opportunities: ReportEntryDraft[] = (
    report.data.report_opportunities ?? []
  )
    .slice()
    .sort((a, b) => a.display_order - b.display_order)
    .map((entry) => ({
      opportunityId: entry.opportunity_id,
      editorCommentary: entry.editor_commentary ?? '',
      minimumAccessRank: entry.minimum_access_rank,
    }));

  const candidateRecords: CandidateRecord[] = (candidates.data ?? []).map(
    (row) => {
      const county = row.counties as { name?: string } | null;
      return {
        id: row.id,
        title: row.title,
        category: row.category,
        score: row.score,
        classification: row.score_classification as ScoreClassification,
        county: county?.name ?? null,
        closingDate: row.closing_date,
        minimumAccessRank: row.minimum_access_rank,
      };
    },
  );

  return (
    <>
      <ReportBuilder
        reportId={report.data.id}
        slug={report.data.slug}
        status={report.data.status}
        hasPdf={Boolean(report.data.pdf_file_path)}
        candidates={candidateRecords}
        initial={{
          title: report.data.title,
          reportType: report.data.report_type,
          periodStart: report.data.reporting_period_start ?? '',
          periodEnd: report.data.reporting_period_end ?? '',
          minimumAccessRank: report.data.minimum_access_rank,
          executiveSummary: textOf(report.data.executive_summary),
          marketCommentary: textOf(report.data.market_commentary),
          scheduledAt: report.data.scheduled_at
            ? String(report.data.scheduled_at).slice(0, 16)
            : '',
          sections,
          opportunities,
        }}
      />
      {/* Supporting files for the report itself — source PDFs, data extracts.
          Separate from the generated report PDF, which the builder handles. */}
      <div className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
        <AttachmentsPanel reportId={report.data.id} />
      </div>
    </>
  );
}
