import { createAdminClient } from '@/lib/db/admin';
import { dailyKey, type JobDefinition } from '@/lib/jobs/runner';
import { fetchBlsEmployment, BLS_SERIES } from '@/lib/market/bls';

export const refreshMarketDataJob: JobDefinition = {
  name: 'refresh-market-data',
  description:
    'Refreshes reviewed public BLS Georgia construction employment observations.',
  idempotencyKey: dailyKey,
  handler: async ({ now }) => {
    const client = createAdminClient();
    const { data: indicator, error } = await client
      .from('market_indicators')
      .select(
        'id,source_id,unit,geographic_scope,description,is_active,update_frequency',
      )
      .eq('slug', 'georgia-construction-employment')
      .single();
    if (error || !indicator)
      throw new Error('BLS market indicator is not configured.');
    if (!indicator.is_active)
      return {
        processed: 0,
        failed: 0,
        skipped: true,
        detail: { reason: 'indicator_disabled' },
      };
    if (
      !indicator.source_id ||
      indicator.unit !== 'thousands of jobs' ||
      indicator.geographic_scope !== 'Georgia' ||
      indicator.update_frequency !== 'monthly' ||
      !indicator.description?.includes('Seasonally adjusted')
    ) {
      throw new Error(
        'BLS indicator metadata does not match the approved series.',
      );
    }
    const { data: source, error: sourceError } = await client
      .from('sources')
      .select(
        'id,is_active,website_url,automation_allowed,scraping_review_status,terms_reviewed_at',
      )
      .eq('id', indicator.source_id)
      .single();
    if (sourceError || !source || source.website_url !== 'https://www.bls.gov')
      throw new Error('BLS source binding is invalid.');
    if (
      !source.is_active ||
      !source.automation_allowed ||
      !source.terms_reviewed_at ||
      !['permitted', 'permitted_with_limits'].includes(
        source.scraping_review_status,
      )
    ) {
      throw new Error(
        'BLS source automation requires a recorded permitted review.',
      );
    }
    const observations = await fetchBlsEmployment(now);
    const { error: writeError } = await client
      .from('market_indicator_values')
      .upsert(
        observations.map((row) => ({ ...row, indicator_id: indicator.id })),
        {
          onConflict:
            'indicator_id,reporting_period_start,reporting_period_end',
        },
      );
    if (writeError)
      throw new Error(
        `BLS observations could not be saved: ${writeError.message}`,
      );
    const { error: checkError } = await client
      .from('sources')
      .update({
        last_checked_at: now.toISOString(),
        next_check_at: new Date(now.getTime() + 86400000).toISOString(),
      })
      .eq('id', source.id);
    if (checkError) throw new Error('BLS source check could not be recorded.');
    return {
      processed: observations.length,
      failed: 0,
      detail: {
        series: BLS_SERIES,
        latest_period: observations.at(-1)?.reporting_period_end,
        source: 'U.S. Bureau of Labor Statistics',
      },
    };
  },
};
