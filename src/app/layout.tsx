import type { Metadata, Viewport } from 'next';

import { publicEnv } from '@/lib/env';

import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: 'Georgia Opportunity Ledger',
    template: '%s — Georgia Opportunity Ledger',
  },
  description:
    'Verified commercial property, business funding and market pricing ' +
    'intelligence for Georgia, scored and tracked to the deadline.',
  applicationName: 'Georgia Opportunity Ledger',
  openGraph: {
    type: 'website',
    siteName: 'Georgia Opportunity Ledger',
    locale: 'en_US',
  },
  twitter: { card: 'summary_large_image' },
  robots: {
    index: publicEnv.environment === 'production',
    follow: publicEnv.environment === 'production',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1a2424',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        {publicEnv.environment !== 'production' ? (
          <p className="bg-purple-900 px-4 py-1.5 text-center text-xs font-semibold text-white">
            {publicEnv.environment} environment — data here may be sample data
            and payments are in test mode.
          </p>
        ) : null}
        {children}
      </body>
    </html>
  );
}
