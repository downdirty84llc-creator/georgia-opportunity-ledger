import { describe, expect, it } from 'vitest';

import {
  advancedFiltersInUse,
  decodeCursor,
  describeFilters,
  encodeCursor,
  filterSchema,
  parseFilters,
  parseStoredFilters,
  sortSpec,
  stripAdvancedFilters,
} from '@/lib/search/filters';

describe('filter parsing', () => {
  it('parses a URL query string', () => {
    const params = new URLSearchParams(
      'q=warehouse&category=commercial_property,business_funding&minScore=70&closingSoon=true&sort=closing_soon',
    );
    const filters = parseFilters(params);
    expect(filters.q).toBe('warehouse');
    expect(filters.category).toEqual(['commercial_property', 'business_funding']);
    expect(filters.minScore).toBe(70);
    expect(filters.closingSoon).toBe(true);
    expect(filters.sort).toBe('closing_soon');
  });

  it('rejects unknown enum values', () => {
    const result = filterSchema.safeParse({ category: 'yachts' });
    expect(result.success).toBe(false);
  });

  it('stored documents that predate the schema degrade to empty, not throw', () => {
    expect(parseStoredFilters({ category: 'yachts' }).category).toBeUndefined();
    expect(parseStoredFilters(null).sort).toBe('score_desc');
    expect(parseStoredFilters('garbage').limit).toBe(20);
  });
});

describe('advanced filter gating (spec 6)', () => {
  it('identifies advanced filters in use', () => {
    const filters = filterSchema.parse({ minScore: 70, q: 'warehouse' });
    expect(advancedFiltersInUse(filters)).toEqual(['minScore']);
  });

  it('stripping removes only the advanced keys', () => {
    const filters = filterSchema.parse({
      minScore: 70,
      capitalMax: 100_000,
      q: 'warehouse',
      closingSoon: true,
    });
    const stripped = stripAdvancedFilters(filters);
    expect(stripped.minScore).toBeUndefined();
    expect(stripped.capitalMax).toBeUndefined();
    expect(stripped.q).toBe('warehouse');
    expect(stripped.closingSoon).toBe(true);
  });
});

describe('sorting (spec 11)', () => {
  it('maps every sort option onto a column and direction', () => {
    expect(sortSpec('score_desc')).toEqual({
      column: 'score',
      ascending: false,
      nullsFirst: false,
    });
    expect(sortSpec('closing_soon').ascending).toBe(true);
    expect(sortSpec('capital_asc').column).toBe('capital_required_min');
    expect(sortSpec('value_desc').ascending).toBe(false);
    expect(sortSpec('alphabetical').column).toBe('title');
  });
});

describe('cursor round-trip', () => {
  it('encodes and decodes', () => {
    const cursor = { value: '085', id: 'row-9' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('malformed cursors fall back to the first page', () => {
    expect(decodeCursor('not-base64!!!')).toBeNull();
    expect(decodeCursor(Buffer.from('[]').toString('base64url'))).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

describe('empty-state description (spec 11)', () => {
  it('describes active filters in plain language', () => {
    const filters = filterSchema.parse({
      q: 'warehouse',
      minScore: 70,
      closingSoon: true,
      capitalMax: 250_000,
    });
    const chips = describeFilters(filters);
    expect(chips.join(' ')).toContain('warehouse');
    expect(chips.join(' ')).toContain('70');
    expect(chips.join(' ')).toContain('closing soon');
    expect(chips.join(' ')).toContain('$250,000');
  });
});
