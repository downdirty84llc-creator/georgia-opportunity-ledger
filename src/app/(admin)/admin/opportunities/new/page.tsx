import type { Metadata } from 'next';

import { OpportunityEditor } from '@/components/admin/opportunity-editor';
import { getSessionContext } from '@/lib/auth/session';
import { createServerSupabaseClient } from '@/lib/db/server';
import { emptyDraft } from '@/lib/opportunities/editor-schema';
import { loadEditorOptions } from '@/lib/opportunities/editor-options';
import { roleMayPerform } from '@/lib/opportunities/workflow';

export const metadata: Metadata = { title: 'New opportunity' };
export const dynamic = 'force-dynamic';

export default async function NewOpportunityPage() {
  const { viewer } = await getSessionContext();
  const supabase = await createServerSupabaseClient();
  const options = await loadEditorOptions(supabase);

  return (
    <OpportunityEditor
      opportunityId={null}
      initialDraft={{ ...emptyDraft(), stateId: options.stateId }}
      workflowStatus="draft"
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
