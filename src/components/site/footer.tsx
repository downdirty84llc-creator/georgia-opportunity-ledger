import Link from 'next/link';

const COLUMNS = [
  {
    heading: 'Intelligence',
    links: [
      { href: '/commercial-property', label: 'Commercial property' },
      { href: '/funding', label: 'Business funding' },
      { href: '/pricing-reports', label: 'Pricing reports' },
      { href: '/insights', label: 'Free insights' },
      { href: '/sample-report', label: 'Sample report' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { href: '/pricing', label: 'Membership plans' },
      { href: '/login', label: 'Log in' },
      { href: '/register', label: 'Create an account' },
      { href: '/account/billing', label: 'Billing' },
      { href: '/support', label: 'Support' },
    ],
  },
  {
    heading: 'Standards',
    links: [
      { href: '/legal/editorial-standards', label: 'Editorial standards' },
      { href: '/legal/corrections', label: 'Corrections policy' },
      { href: '/legal/data-sources', label: 'Data source policy' },
      { href: '/corrections/new', label: 'Submit a correction' },
      { href: '/how-it-works', label: 'Methodology' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/legal/terms', label: 'Terms of service' },
      { href: '/legal/privacy', label: 'Privacy policy' },
      { href: '/legal/subscription-terms', label: 'Subscription terms' },
      { href: '/legal/refunds', label: 'Refunds and cancellation' },
      { href: '/legal/disclaimers', label: 'Disclaimers' },
      { href: '/legal/cookies', label: 'Cookie policy' },
      { href: '/legal/acceptable-use', label: 'Acceptable use' },
      { href: '/legal/copyright', label: 'Copyright' },
      { href: '/legal/accessibility', label: 'Accessibility' },
    ],
  },
];

/**
 * Every legal document must be reachable from the footer.
 *
 * `tests/unit/legal/documents.test.ts` asserts this against the document set,
 * so adding a document without linking it fails the build rather than
 * producing a page nobody can find.
 */
export const FOOTER_LEGAL_HREFS = COLUMNS.flatMap((column) =>
  column.links.map((link) => link.href),
).filter((href) => href.startsWith('/legal/'));

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-ink-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-1">
            <p className="font-semibold">Georgia Opportunity Ledger</p>
            <p className="mt-2 max-w-xs text-sm text-ink-600">
              Verified commercial property, funding and pricing intelligence for
              people who have to act on it.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
                {column.heading}
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-ink-700 hover:text-ink-950 hover:underline"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 border-t border-ink-200 pt-6 text-xs leading-relaxed text-ink-500">
          <p className="max-w-3xl">
            The Georgia Opportunity Ledger is a research and decision-support
            service. It is not a real-estate brokerage, a multiple listing
            service, a lender, an investment adviser, a legal service or an
            appraisal service, and nothing published here guarantees
            eligibility, financing or investment performance. Verify every
            figure against the original source before you commit capital.
          </p>
          <p className="mt-4">
            © {new Date().getFullYear()} Georgia Opportunity Ledger. All rights
            reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
