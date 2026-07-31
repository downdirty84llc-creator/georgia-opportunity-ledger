import Link from 'next/link';

import {
  Pill,
  SampleDataBadge,
  ScoreBadge,
  cx,
} from '@/components/ui/primitives';
import { formatDeadline, formatMoneyRange, titleCase } from '@/lib/format';
import type { ScoreClassification } from '@/lib/scoring/score';

export interface OpportunityCardData {
  id: string;
  slug: string;
  title: string;
  category: string;
  subtype?: string | null;
  teaser: string;
  summary?: string | null;
  score: number;
  classification: ScoreClassification;
  county?: string | null;
  city?: string | null;
  closingDate?: string | null;
  isClosingSoon?: boolean;
  isExpired?: boolean;
  isSample?: boolean;
  isLocked?: boolean;
  capitalRequiredMin?: number | null;
  capitalRequiredMax?: number | null;
  estimatedValueMin?: number | null;
  estimatedValueMax?: number | null;
  verificationStatus?: string;
  dateVerified?: string | null;
}

/**
 * The search-result card.
 *
 * A locked record still shows its title, score, county and deadline — enough
 * to judge whether it is worth upgrading for — and says plainly that the detail
 * is above the reader's plan. Blurring text and hoping for a click is the
 * pattern this deliberately avoids.
 */
export function OpportunityCard({
  opportunity,
}: {
  opportunity: OpportunityCardData;
}) {
  const {
    slug,
    title,
    category,
    teaser,
    summary,
    score,
    classification,
    county,
    city,
    closingDate,
    isClosingSoon,
    isExpired,
    isSample,
    isLocked,
  } = opportunity;

  const place = [city, county].filter(Boolean).join(', ') || 'Georgia';

  return (
    <article
      className={cx(
        'surface flex flex-col gap-3 p-5 transition-shadow hover:shadow-sm',
        isExpired && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>{titleCase(category)}</Pill>
            {isSample ? <SampleDataBadge /> : null}
            {isExpired ? <Pill tone="muted">Closed</Pill> : null}
            {isClosingSoon && !isExpired ? (
              <Pill tone="warning">Closing soon</Pill>
            ) : null}
          </div>
          <h3 className="mt-2 text-base font-semibold leading-snug">
            <Link
              href={`/opportunities/${slug}`}
              className="hover:underline focus-visible:underline"
            >
              {title}
            </Link>
          </h3>
          <p className="mt-1 text-sm text-ink-500">{place}</p>
        </div>
        <ScoreBadge score={score} classification={classification} size="sm" />
      </div>

      <p className="text-sm leading-relaxed text-ink-700">
        {summary ?? teaser}
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-ink-100 pt-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            Deadline
          </dt>
          <dd className="mt-0.5 font-medium">{formatDeadline(closingDate)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            Capital required
          </dt>
          <dd className="mt-0.5 font-medium">
            {isLocked
              ? 'Locked'
              : formatMoneyRange(
                  opportunity.capitalRequiredMin,
                  opportunity.capitalRequiredMax,
                )}
          </dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs uppercase tracking-wide text-ink-500">
            Estimated value
          </dt>
          <dd className="mt-0.5 font-medium">
            {isLocked
              ? 'Locked'
              : formatMoneyRange(
                  opportunity.estimatedValueMin,
                  opportunity.estimatedValueMax,
                )}
          </dd>
        </div>
      </dl>

      {isLocked ? (
        <p className="rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-600">
          The full analysis for this record is included with a higher membership
          tier.{' '}
          <Link href="/pricing" className="font-medium text-ink-900 underline">
            Compare plans
          </Link>
        </p>
      ) : null}
    </article>
  );
}
