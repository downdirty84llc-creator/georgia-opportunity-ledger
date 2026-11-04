import { describe, expect, it } from 'vitest';
import { formatDate, formatDeadline } from '@/lib/format';

describe('Georgia calendar dates', () => {
  it('preserves SQL DATE reporting periods in winter and summer', () => {
    expect(formatDate('2026-10-29')).toBe('Oct 29, 2026');
    expect(formatDate('2026-11-04')).toBe('Nov 4, 2026');
    expect(formatDate('2026-07-01')).toBe('Jul 1, 2026');
  });
  it('still converts actual timestamps to Georgia time', () => {
    expect(formatDate('2026-11-04T00:00:00Z')).toBe('Nov 3, 2026');
    expect(formatDate(new Date('2026-11-04T18:00:00Z'))).toBe('Nov 4, 2026');
  });
  it('does not normalize an impossible date into a different day', () => {
    expect(formatDate('2026-02-30')).toBe('—');
    expect(formatDeadline('2026-02-30')).toBe('No stated deadline');
    expect(formatDate('invalid')).toBe('—');
  });
  it('keeps a date-only deadline open for its whole local calendar day', () => {
    expect(formatDeadline('2026-11-04', new Date('2026-11-05T04:59:00Z'))).toBe(
      'Closes today',
    );
    expect(formatDeadline('2026-11-04', new Date('2026-11-05T05:00:00Z'))).toBe(
      'Closed Nov 4, 2026',
    );
  });
  it('uses tomorrow across local midnight even with less than 24 hours left', () => {
    expect(
      formatDeadline('2026-11-05T06:00:00Z', new Date('2026-11-05T04:00:00Z')),
    ).toBe('Closes tomorrow');
  });
  it('marks an elapsed timestamp closed on the same day', () => {
    expect(
      formatDeadline('2026-11-04T17:00:00Z', new Date('2026-11-04T18:00:00Z')),
    ).toBe('Closed Nov 4, 2026');
  });
  it('counts calendar days across daylight-saving transitions', () => {
    expect(
      formatDeadline('2026-03-09T13:00:00Z', new Date('2026-03-08T13:30:00Z')),
    ).toBe('Closes tomorrow');
    expect(
      formatDeadline('2026-11-02T14:00:00Z', new Date('2026-10-31T13:00:00Z')),
    ).toBe('Closes in 2 days');
  });
  it('preserves distant date-only deadline labels', () => {
    expect(formatDeadline('2026-12-01', new Date('2026-11-04T18:00:00Z'))).toBe(
      'Closes Dec 1, 2026',
    );
  });
});
