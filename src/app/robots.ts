import type { MetadataRoute } from 'next';

import { isProduction, publicEnv } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const base = publicEnv.siteUrl.replace(/\/$/, '');

  // Staging and development are never indexed at all.
  if (!isProduction) {
    return { rules: { userAgent: '*', disallow: '/' } };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/account',
        '/dashboard',
        '/saved',
        '/calendar',
        '/admin',
        '/api/',
        '/opportunities?', // search-result combinations
        '/login',
        '/register',
        '/auth/',
        '/support',
        '/corrections/',
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
