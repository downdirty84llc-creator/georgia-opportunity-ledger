import type { MetadataRoute } from 'next';

import { publicEnv } from '@/lib/env';
import { LEGAL_DOCUMENTS } from '@/lib/legal/documents';
import { loadCountiesWithCounts } from '@/lib/public-data';

/**
 * Sitemap covers public marketing and county pages only. Member content,
 * search-result combinations, account and admin pages are all excluded and
 * additionally blocked in robots.ts (spec 24).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicEnv.siteUrl.replace(/\/$/, '');

  const staticPages = [
    '',
    '/commercial-property',
    '/funding',
    '/pricing-reports',
    '/insights',
    '/pricing',
    '/how-it-works',
    '/sample-report',
  ].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: 'weekly' as const,
    priority: path === '' ? 1 : 0.7,
  }));

  const legalPages = LEGAL_DOCUMENTS.map((document) => ({
    url: `${base}/legal/${document.slug}`,
    changeFrequency: 'monthly' as const,
    priority: 0.3,
  }));

  const counties = await loadCountiesWithCounts();
  const countyPages = counties.map((county) => ({
    url: `${base}/georgia/${county.slug}`,
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...legalPages, ...countyPages];
}
