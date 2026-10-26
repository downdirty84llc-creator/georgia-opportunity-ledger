import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { loadPublicStats } = vi.hoisted(() => ({ loadPublicStats: vi.fn() }));
vi.mock('@/lib/public-data', () => ({
  loadPublicStats,
  loadPreviewOpportunities: async () => [],
  loadIndicatorPreviews: async () => [],
}));

import HomePage from '@/app/(marketing)/page';

beforeEach(() => vi.clearAllMocks());

async function coverageSection() {
  const html = renderToStaticMarkup(await HomePage());
  const match = html.match(
    /<section aria-label="Coverage at a glance"[\s\S]*?<\/section>/,
  );
  expect(match).not.toBeNull();
  return match![0];
}

describe('homepage statistics', () => {
  it('renders a clear unavailable state when the database cannot supply counts', async () => {
    loadPublicStats.mockResolvedValue(null);
    const html = await coverageSection();
    expect(html.match(/Unavailable/g)).toHaveLength(4);
    expect(html).not.toMatch(/>0<\/p>/);
    expect(html).toContain('Active opportunities');
  });

  it('renders a verified zero and labels the geography directory accurately', async () => {
    loadPublicStats.mockResolvedValue({
      activeOpportunities: 0,
      countiesCovered: 159,
      verifiedThisWeek: 7,
      upcomingDeadlines: 2,
    });
    const html = await coverageSection();
    expect(html).toMatch(/>0<\/p>/);
    expect(html).toContain('Georgia counties in directory');
    expect(html).not.toContain('Unavailable');
  });
});
