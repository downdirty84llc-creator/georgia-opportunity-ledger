import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { OpportunityEditor } from '@/components/admin/opportunity-editor';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { loadEditorOptions } from '@/lib/opportunities/editor-options';
import { draftFromRecord } from '@/lib/opportunities/editor-loader';
import { roleMayPerform } from '@/lib/opportunities/workflow';

export const metadata: Metadata = { title: 'Edit opportunity' };
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ id: string }> };

export default async function EditOpportunityPage({ params }: PageProps) {
  const { id } = await params;
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();

  const [record, options] = await Promise.all([
    supabase
      .from('opportunities')
      .select(
        `*,
         property_details ( * ),
         funding_details ( * ),
         opportunity_score_components ( * )`,
      )
      .eq('id', id)
      .maybeSingle(),
    loadEditorOptions(supabase),
  ]);

  if (!record.data) notFound();

  return (
    <OpportunityEditor
      opportunityId={id}
      initialDraft={draftFromRecord(record.data as Record<string, unknown>)}
      workflowStatus={String(record.data.workflow_status)}
      counties={options.counties}
      cities={options.cities}
      industries={options.industries}
      sources={options.sources}
      stateId={options.stateId}
      canApprove={roleMayPerform(viewer.role, 'approve')}
      canPublish={roleMayPerform(viewer.role, 'publish')}
    />
  );
}
