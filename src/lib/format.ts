/**
 * Display formatting.
 *
 * Ranges are rendered as ranges rather than as a single number, because
 * "$250,000–$400,000" is honest about how much we actually know and a bare
 * midpoint is not.
 */

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return currency.format(value);
}

export function formatCompactMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return compactCurrency.format(value);
}

export function formatMoneyRange(
  min: number | null | undefined,
  max: number | null | undefined,
): string {
  const hasMin = typeof min === 'number' && Number.isFinite(min);
  const hasMax = typeof max === 'number' && Number.isFinite(max);

  if (!hasMin && !hasMax) return 'Not stated';
  if (hasMin && hasMax) {
    return min === max
      ? formatMoney(min)
      : `${formatCompactMoney(min)} – ${formatCompactMoney(max)}`;
  }
  return hasMin ? `From ${formatCompactMoney(min)}` : `Up to ${formatCompactMoney(max)}`;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'America/New_York',
});

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

/**
 * Relative deadline wording. Deliberately concrete near the deadline
 * ("closes tomorrow") and vaguer further out, matching how people actually
 * think about lead time.
 */
export function formatDeadline(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return 'No stated deadline';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'No stated deadline';

  const days = Math.floor(
    (date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
  );

  if (days < 0) return `Closed ${formatDate(date)}`;
  if (days === 0) return 'Closes today';
  if (days === 1) return 'Closes tomorrow';
  if (days <= 14) return `Closes in ${days} days`;
  return `Closes ${formatDate(date)}`;
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bAnd\b/g, 'and')
    .replace(/\bOr\b/g, 'or');
}

export function pluralize(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return count === 1 ? singular : plural;
}
