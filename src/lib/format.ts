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
  return hasMin
    ? `From ${formatCompactMoney(min)}`
    : `Up to ${formatCompactMoney(max)}`;
}

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'America/New_York',
});

const calendarDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});
const newYorkDay = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: 'America/New_York',
});
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86_400_000;

function parseDisplayDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (
    typeof value === 'string' &&
    dateOnly.test(value) &&
    date.toISOString().slice(0, 10) !== value
  )
    return null;
  return date;
}

function localDayNumber(date: Date): number {
  const parts = newYorkDay.formatToParts(date);
  const part = (type: string) =>
    Number(parts.find((item) => item.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day')) / dayMs;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = parseDisplayDate(value);
  if (!date) return '—';
  // A SQL DATE is a calendar label, not midnight UTC shifted into Georgia time.
  return typeof value === 'string' && dateOnly.test(value)
    ? calendarDateFormatter.format(date)
    : dateFormatter.format(date);
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
  const date = parseDisplayDate(value);
  if (!date || Number.isNaN(now.getTime())) return 'No stated deadline';
  const isDateOnly = typeof value === 'string' && dateOnly.test(value);
  const days =
    (isDateOnly ? date.getTime() / dayMs : localDayNumber(date)) -
    localDayNumber(now);

  if (days < 0 || (!isDateOnly && date.getTime() < now.getTime()))
    return `Closed ${formatDate(value)}`;
  if (days === 0) return 'Closes today';
  if (days === 1) return 'Closes tomorrow';
  if (days <= 14) return `Closes in ${days} days`;
  return `Closes ${formatDate(value)}`;
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
