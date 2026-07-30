import type { Metadata } from 'next';
import Link from 'next/link';

import { OpportunityCard } from '@/components/opportunities/opportunity-card';
import {
  ButtonLink,
  Card,
  EmptyState,
  Pill,
  SectionHeading,
} from '@/components/ui/primitives';
import { getSessionContext } from '@/lib/auth/session';
import { needsPaymentAttention, paidAccessEndsAt } from '@/lib/billing/subscription';
import { createServerSupabaseClient } from '@/lib/db/server';
import { formatDate, formatDeadline, pluralize } from '@/lib/format';
import { loadIndicatorPreviews } from '@/lib/public-data';
import { searchOpportunities } from '@/lib/opportunities/query';
import { parseStoredFilters } from '@/lib/search/filters';
import type { ScoreClassification } from '@/lib/scoring/score';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const session = await getSessionContext();
  const { viewer } = session;
  const supabase = await createServerSupabaseClient();

  // The dashboard is personalised from stored preferences: counties and
  // industries the member chose, and their minimum score.
  const { data: preferences } = await supabase
    .from('user_preferences')
    .select('preferred_county_ids, preferred_industry_ids, minimum_score')
    .eq('user_id', viewer.userId)
    .maybeSingle();

  const preferenceFilters = parseStoredFilters({
    countyIds: preferences?.preferred_county_ids ?? undefined,
    industryIds: preferences?.preferred_industry_ids ?? undefined,
    minScore: preferences?.minimum_score ?? undefined,
    limit: 6,
  });

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [recommended, closing, savedCount, newThisWeek, highScore, indicators, alerts] =
    await Promise.all([
      searchOpportunities(supabase, viewer, preferenceFilters),
      searchOpportunities(
        supabase,
        viewer,
        parseStoredFilters({ closingSoon: true, sort: 'closing_soon', limit: 5 }),
      ),
      supabase
        .from('saved_opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', viewer.userId),
      supabase
        .from('opportunity_previews')
        .select('id', { count: 'exact', head: true })
        .gte('published_at', weekAgo.toISOString()),
      supabase
        .from('opportunity_previews')
        .select('id', { count: 'exact', head: true })
        .gte('score', 85)
        .eq('is_expired', false),
      loadIndicatorPreviews(5),
      supabase
        .from('notifications')
        .select('id, title, message, action_url, sent_at, is_read')
        .eq('user_id', viewer.userId)
        .order('sent_at', { ascending: false })
        .limit(5),
    ]);

  const accessEnds = paidAccessEndsAt(session.subscription);
  const paymentAttention = needsPaymentAttention(session.subscription);
  const greeting = session.profile?.firstName
    ? `Good to see you, ${session.profile.firstName}.`
    : 'Good to see you.';

  const metrics = [
    { label: 'New this week', value: newThisWeek.count ?? 0, href: '/opportunities?sort=newest' },
    {
      label: 'Closing soon',
      value: closing.totalCount,
      href: '/opportunities?closingSoon=true',
    },
    { label: 'Saved', value: savedCount.count ?? 0, href: '/saved' },
    {
      label: 'Immediate action',
      value: highScore.count ?? 0,
      href: '/opportunities?minScore=85',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl">{greeting}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-600">
            <Pill>{session.planName}</Pill>
            {accessEnds ? (
              <span>
                {session.cancelAtPeriodEnd ? 'Access ends' : 'Renews'}{' '}
                {formatDate(accessEnds)}
              </span>
            ) : session.currentPeriodEnd ? (
              <span>Renews {formatDate(session.currentPeriodEnd)}</span>
            ) : null}
          </div>
        </div>
        {viewer.planCode !== 'premium' && !viewer.isStaff ? (
          <ButtonLink href="/pricing">Upgrade membership</ButtonLink>
        ) : null}
      </div>

      {paymentAttention ? (
        <p className="mt-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong className="font-semibold">Payment needs attention.</strong>{' '}
          Your most recent payment did not go through. Update your payment
          method to keep your access — nothing you have saved will be lost
          either way.{' '}
          <Link href="/account/billing" className="font-medium underline">
            Open the billing portal
          </Link>
          .
        </p>
      ) : null}

      <section aria-label="This week at a glance" className="mt-8">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {metrics.map((metric) => (
            <Link
              key={metric.label}
              href={metric.href}
              className="surface p-4 transition-colors hover:border-ink-400"
            >
              <p className="text-2xl font-semibold tabular-nums">{metric.value}</p>
              <p className="mt-1 text-sm text-ink-600">{metric.label}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.6fr,1fr]">
        <div className="space-y-10">
          <section>
            <SectionHeading
              eyebrow="For you"
              title="Recommended"
              description={
                preferenceFilters.countyIds?.length
                  ? 'Weighted toward the counties and industries you follow.'
                  : 'Set your preferences to weight this toward your market.'
              }
              action={
                <ButtonLink href="/opportunities" variant="secondary">
                  Search all
                </ButtonLink>
              }
            />
            {recommended.rows.length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {recommended.rows.map((row) => (
                  <OpportunityCard
                    key={row.id}
                    opportunity={{
                      id: row.id,
                      slug: row.slug,
                      title: row.title,
                      category: row.category,
                      teaser: row.teaser,
                      summary: row.summary,
                      score: row.score,
                      classification: row.score_classification as ScoreClassification,
                      county: row.county_name,
                      city: row.city_name,
                      closingDate: row.closing_date,
                      isClosingSoon: row.is_closing_soon,
                      isExpired: row.is_expired,
                      isSample: row.is_sample,
                      isLocked: row.is_locked,
                      capitalRequiredMin: row.capital_required_min,
                      capitalRequiredMax: row.capital_required_max,
                      estimatedValueMin: row.estimated_value_min,
                      estimatedValueMax: row.estimated_value_max,
                    }}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                title="Nothing matches your preferences yet"
                description="Either no published record matches the counties, industries and minimum score you have set, or your preferences are still at their defaults."
              >
                <ButtonLink href="/account/preferences" variant="secondary">
                  Adjust preferences
                </ButtonLink>
                <ButtonLink href="/opportunities">Browse everything</ButtonLink>
              </EmptyState>
            )}
          </section>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-semibold">Closing soon</h2>
            {closing.rows.length > 0 ? (
              <ul className="surface mt-3 divide-y divide-ink-100">
                {closing.rows.map((row) => (
                  <li key={row.id} className="px-4 py-3">
                    <Link
                      href={`/opportunities/${row.slug}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {row.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {row.county_name ?? 'Georgia'} ·{' '}
                      {formatDeadline(row.closing_date)}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="surface mt-3 px-4 py-5 text-sm text-ink-600">
                Nothing closes in the next fortnight.
              </p>
            )}
            <Link
              href="/calendar"
              className="mt-3 inline-block text-sm font-medium underline"
            >
              Open the deadline calendar
            </Link>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Market pulse</h2>
            <dl className="surface mt-3 divide-y divide-ink-100">
              {indicators.map((indicator) => (
                <div
                  key={indicator.id}
                  className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                >
                  <dt className="truncate text-sm">{indicator.name}</dt>
                  <dd className="shrink-0 text-sm font-semibold tabular-nums">
                    {indicator.percentChange === null
                      ? '—'
                      : `${indicator.percentChange > 0 ? '+' : ''}${indicator.percentChange.toFixed(1)}%`}
                  </dd>
                </div>
              ))}
              {indicators.length === 0 ? (
                <p className="px-4 py-5 text-sm text-ink-600">
                  No indicators available.
                </p>
              ) : null}
            </dl>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Recent alerts</h2>
            {(alerts.data ?? []).length > 0 ? (
              <ul className="surface mt-3 divide-y divide-ink-100">
                {(alerts.data ?? []).map((notification) => (
                  <li key={notification.id} className="px-4 py-3">
                    <Link
                      href={notification.action_url ?? '/dashboard'}
                      className="text-sm font-medium hover:underline"
                    >
                      {notification.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {formatDate(notification.sent_at)}
                      {notification.is_read ? '' : ' · unread'}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <Card className="mt-3">
                <p className="text-sm text-ink-600">
                  No alerts yet.{' '}
                  {viewer.features.immediateAlerts
                    ? 'You will be notified as matching records publish.'
                    : 'Immediate alerts are included with Premium.'}
                </p>
                {!viewer.features.immediateAlerts ? (
                  <Link
                    href="/pricing"
                    className="mt-2 inline-block text-sm font-medium underline"
                  >
                    Compare plans
                  </Link>
                ) : null}
              </Card>
            )}
          </section>

          {savedCount.count !== null && viewer.features.savedOpportunityLimit !== null ? (
            <p className="text-xs text-ink-500">
              You have saved {savedCount.count} of{' '}
              {viewer.features.savedOpportunityLimit}{' '}
              {pluralize(viewer.features.savedOpportunityLimit, 'opportunity', 'opportunities')}{' '}
              available on your plan.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
