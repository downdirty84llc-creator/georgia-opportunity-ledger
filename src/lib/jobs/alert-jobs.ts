import {
  shouldSendHighScoreAlert,
  type AlertRecipient,
} from '@/lib/alerts/matching';
import { createAdminClient } from '@/lib/db/admin';
import {
  EMAIL_CANDIDATE_SELECT,
  toCandidate,
  type CandidateRow,
} from '@/lib/email/candidates';
import { loadRecipientPage } from '@/lib/email/recipients';
import { parseStoredFilters } from '@/lib/search/filters';
import type { JobDefinition } from '@/lib/jobs/runner';

interface SearchProgress extends Record<string, unknown> {
  afterSearch?: string;
  searchId?: string;
  afterOpportunity?: string;
  windowEnd?: string;
  searchVersion?: string;
  matched?: boolean;
}
export const savedSearchMatchingJob: JobDefinition = {
  name: 'saved-search-matching',
  description:
    'Matches saved searches with resumable per-search candidate cursors.',
  handler: async (context) => {
    if (!context.checkpoint)
      throw new Error('Saved-search matching requires durable checkpoints.');
    const checkpoint = context.checkpoint,
      client = createAdminClient();
    let progress: SearchProgress = { ...context.state };
    const deadline = context.deadlineAt ?? Date.now() + 25_000;
    let matched = 0;
    while (Date.now() < deadline - 5000) {
      let query = client
        .from('saved_searches')
        .select(
          'id,user_id,name,filter_configuration,minimum_score,last_run_at,updated_at',
        )
        .eq('alert_enabled', true)
        .eq('alert_frequency', 'immediate')
        .order('id')
        .limit(1);
      if (progress.searchId) query = query.eq('id', progress.searchId);
      else if (progress.afterSearch)
        query = query.gt('id', progress.afterSearch);
      const { data: search, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      if (!search) {
        if (progress.searchId) {
          progress = { afterSearch: progress.searchId };
          await checkpoint(progress);
          continue;
        }
        await checkpoint({});
        return {
          processed: matched,
          failed: 0,
          detail: { cycleComplete: true },
        };
      }
      const recipient = (
        await loadRecipientPage(context.now, { ids: [search.user_id] })
      ).recipients[0];
      if (
        !recipient ||
        !recipient.immediateAlertsEntitled ||
        recipient.accessRank < 30
      ) {
        progress = { afterSearch: search.id };
        await checkpoint(progress);
        continue;
      }
      if (
        progress.searchId !== search.id ||
        progress.searchVersion !== search.updated_at
      ) {
        progress = {
          ...progress,
          searchId: search.id,
          afterOpportunity: undefined,
          windowEnd: context.now.toISOString(),
          searchVersion: search.updated_at,
          matched: false,
        };
        await checkpoint(progress);
      }
      const filters = parseStoredFilters(search.filter_configuration);
      let candidates = client
        .from('opportunities')
        .select(EMAIL_CANDIDATE_SELECT)
        .eq('workflow_status', 'published')
        .eq('is_restricted', false)
        .eq('is_expired', false)
        .gte('score', search.minimum_score)
        .gte(
          'updated_at',
          search.last_run_at ??
            new Date(context.now.getTime() - 86400000).toISOString(),
        )
        .lt('updated_at', progress.windowEnd!)
        .lte('published_at', progress.windowEnd!)
        .order('id')
        .limit(50);
      if (progress.afterOpportunity)
        candidates = candidates.gt('id', progress.afterOpportunity);
      if (filters.q)
        candidates = candidates.textSearch('search_vector', filters.q, {
          type: 'websearch',
          config: 'english',
        });
      const { data: rows, error: candidateError } = await candidates;
      if (candidateError) throw new Error(candidateError.message);
      const searchRecipient: AlertRecipient = { ...recipient, filters };
      for (const row of (rows ?? []) as unknown as CandidateRow[]) {
        if (Date.now() >= deadline - 5000)
          return { processed: matched, failed: 0, detail: { more: true } };
        if (
          shouldSendHighScoreAlert(
            toCandidate(row, 1),
            searchRecipient,
            context.now,
          ).send
        ) {
          const { error: insertError } = await client
            .from('notifications')
            .insert({
              user_id: search.user_id,
              dedupe_key: `saved_search:${search.id}:${row.id}`,
              notification_type: 'saved_search_match',
              title: `${search.name}: ${row.title}`,
              message: row.summary.slice(0, 400),
              opportunity_id: row.id,
              action_url: `/opportunities/${row.slug}`,
            });
          if (insertError && insertError.code !== '23505')
            throw new Error(insertError.message);
          if (!insertError) {
            matched++;
            progress.matched = true;
          }
        }
        progress = { ...progress, afterOpportunity: row.id };
        await checkpoint(progress);
      }
      if ((rows?.length ?? 0) < 50) {
        const { error: finishError } = await client
          .from('saved_searches')
          .update({
            last_run_at: progress.windowEnd,
            ...(progress.matched
              ? { last_match_at: new Date().toISOString() }
              : {}),
          })
          .eq('id', search.id)
          .eq('updated_at', progress.searchVersion!);
        if (finishError) throw new Error(finishError.message);
        progress = { afterSearch: search.id };
        await checkpoint(progress);
      }
    }
    return { processed: matched, failed: 0, detail: { more: true } };
  },
};
