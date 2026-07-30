/**
 * Legal and policy documents (spec 25).
 *
 * These are drafted to describe how the product actually behaves — the access
 * rules, the billing behaviour, the retention posture — so that a lawyer is
 * reviewing an accurate description rather than writing from scratch. Every
 * document is marked as requiring review, and the launch checklist blocks
 * production on that review being signed off.
 */

export interface LegalSection {
  heading: string;
  body: readonly string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  summary: string;
  /** True until counsel has signed the document off. */
  requiresReview: boolean;
  sections: readonly LegalSection[];
}

const REVIEW_NOTICE =
  'This document describes how the service currently operates. It has not yet ' +
  'been reviewed by counsel and must be before the service accepts live ' +
  'payments.';

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    summary: 'The agreement between you and the Georgia Opportunity Ledger.',
    requiresReview: true,
    sections: [
      {
        heading: 'What this service is',
        body: [
          'The Georgia Opportunity Ledger is a subscription research and decision-support platform. We collect information about commercial property, business funding and market pricing from public or authorised sources, verify it, classify it, score it, and make it available to subscribers.',
          'We are not a real-estate brokerage, a multiple listing service, a lender, an investment adviser, a legal service or an appraisal service. Nothing published here is a guarantee of eligibility, financing or investment performance.',
        ],
      },
      {
        heading: 'Your account',
        body: [
          'You are responsible for keeping your login credentials confidential and for activity carried out through your account. Accounts are for a single person; sharing credentials, or redistributing paid content outside your organisation, is a breach of these terms.',
          'We may suspend an account for non-payment, for credential sharing, for automated scraping of paid content, or for abuse. A suspended account keeps everything it has saved and may still contact support to appeal.',
        ],
      },
      {
        heading: 'Accuracy and your own diligence',
        body: [
          'We take verification seriously and record when each record was last checked. We do not warrant that any record is complete, current or free of error, and public sources themselves change without notice.',
          'You must verify every material fact against the original source before you commit capital, submit an application, or place a bid. Where the ledger and the source disagree, the source governs.',
        ],
      },
      {
        heading: 'Intellectual property',
        body: [
          'The underlying facts we report are not ours. Our analysis, scoring, commentary, reports and the compilation itself are, and are licensed to you for your own business use for as long as your subscription is active.',
          'You may export and use records internally. You may not republish, resell or systematically redistribute paid content.',
        ],
      },
      {
        heading: 'Limitation of liability',
        body: [
          'To the fullest extent permitted by law, our aggregate liability arising out of the service is limited to the amount you paid us in the twelve months preceding the claim.',
          REVIEW_NOTICE,
        ],
      },
    ],
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    summary: 'What we collect, why, and the controls you have over it.',
    requiresReview: true,
    sections: [
      {
        heading: 'What we collect',
        body: [
          'Account information you give us: name, email address, optional company name and phone number. Preference information: the counties, industries, property and funding types you want to hear about, and your alert settings.',
          'Usage information: which pages and records you open, which searches you run, and which emails you open. This is used to improve the product and to measure whether the service is worth what you pay for it.',
        ],
      },
      {
        heading: 'What we deliberately do not store',
        body: [
          'We never store full payment card numbers or banking credentials. Card handling is performed entirely by Stripe; our systems receive a customer reference and a subscription status, nothing more.',
          'We do not store identity documents, and we do not put personal information into analytics event properties — analytics events carry identifiers and structural facts only.',
        ],
      },
      {
        heading: 'Your controls',
        body: [
          'From your account you can update email preferences, opt out of marketing, opt out of alerts, request an export of your data, request deletion of your account, and manage cookie preferences.',
          'A deletion request removes your profile, preferences, saved records and saved searches. Billing records are retained where we are required to keep them for tax and accounting purposes.',
          REVIEW_NOTICE,
        ],
      },
    ],
  },
  {
    slug: 'subscription-terms',
    title: 'Subscription Terms',
    summary: 'Billing, renewal, upgrades, downgrades and what happens on lapse.',
    requiresReview: true,
    sections: [
      {
        heading: 'Billing and renewal',
        body: [
          'Subscriptions are billed in advance, monthly or annually, and renew automatically until cancelled. Prices are shown before checkout and on your invoice.',
          'Annual plans are charged as a single payment for twelve months of access.',
        ],
      },
      {
        heading: 'Upgrades and downgrades',
        body: [
          'An upgrade takes effect immediately and is prorated: you pay the difference for the remainder of the current period.',
          'A downgrade takes effect at the end of the period you have already paid for. You keep the higher tier until then.',
        ],
      },
      {
        heading: 'Failed payments',
        body: [
          'If a payment fails, we retain your access while the card is retried and for three days afterwards, and email you a link to update your payment method.',
          'After that window the account returns to the free tier. Saved opportunities, saved searches and notes are retained; paid features such as export and saved-search alerts stop.',
        ],
      },
      {
        heading: 'Cancellation',
        body: [
          'Cancel at any time from the billing portal. Access continues to the end of the period you have paid for, then the account returns to the free tier.',
          REVIEW_NOTICE,
        ],
      },
    ],
  },
  {
    slug: 'refunds',
    title: 'Refund and Cancellation Policy',
    summary: 'When we refund, and how to ask.',
    requiresReview: true,
    sections: [
      {
        heading: 'The general position',
        body: [
          'Subscriptions are paid in advance and cancellation stops the next renewal rather than refunding the current period. You keep access until the period ends.',
        ],
      },
      {
        heading: 'When we will refund',
        body: [
          'Duplicate or erroneous charges are refunded in full, promptly, without argument.',
          'If you were charged after cancelling, that is our error and we refund it.',
          'If the service was materially unavailable, or a record we published was wrong in a way that cost you real money, contact support. We would rather resolve it than defend a subscription fee.',
        ],
      },
      {
        heading: 'How to request one',
        body: [
          'Email support or open a ticket from your account. Refunds are approved by a billing manager and every refund action is recorded in the audit log.',
          REVIEW_NOTICE,
        ],
      },
    ],
  },
  {
    slug: 'editorial-standards',
    title: 'Editorial Standards',
    summary: 'How a record earns its place in the ledger.',
    requiresReview: false,
    sections: [
      {
        heading: 'Sourcing',
        body: [
          'Every published record is traced to a named source and links to it. Where a record relies on more than one source, each supporting source is recorded with its own URL and date.',
          'We prefer primary government sources. Where we rely on a secondary source, the reliability score reflects that, and the score is lower as a result.',
        ],
      },
      {
        heading: 'Separation of duties',
        body: [
          'A researcher drafts. A reviewer checks the record against its sources, sets the component scores and approves. An editor publishes. No single person can carry a record from draft to publication.',
          'Score adjustments cannot be saved without a written reason, and the reason is published to members who can see the score explanation.',
        ],
      },
      {
        heading: 'Freshness',
        body: [
          'Published records are reverified on a thirty-day cycle. Deadline flags are recomputed daily so that a lapsed record is marked expired rather than left looking live.',
          'Material changes — a moved deadline, a changed amount, rewritten eligibility, a reopened status — create a new version of the record and may trigger an update alert.',
        ],
      },
      {
        heading: 'Independence',
        body: [
          'We take no payment, commission or consideration from any source, lender, broker, seller or program administrator in exchange for coverage, placement or score.',
          'Testimonials are published only where they are genuine and attributable. We do not invent them.',
        ],
      },
    ],
  },
  {
    slug: 'corrections',
    title: 'Corrections Policy',
    summary: 'What we do when we get something wrong.',
    requiresReview: false,
    sections: [
      {
        heading: 'Report a correction',
        body: [
          'Every record carries a correction link. Anyone — subscriber or not — can submit one, and you do not need to explain why you care.',
          'Include the source that contradicts us if you have it. That is usually enough for us to act the same day.',
        ],
      },
      {
        heading: 'What happens next',
        body: [
          'A reviewer checks the submission against the source. If we were wrong, we correct the record, note the correction, and publish it.',
          'Where the error was material — a wrong deadline, a wrong amount, a wrong eligibility rule — members who were alerted to the original are told about the correction.',
          'Correction publications are written to the audit log. We do not quietly edit a record and pretend it always said that.',
        ],
      },
    ],
  },
  {
    slug: 'data-sources',
    title: 'Data Source Policy',
    summary: 'How we decide what we may collect, and how.',
    requiresReview: false,
    sections: [
      {
        heading: 'Public and authorised only',
        body: [
          'We collect from public records, government publications, authorised listings and licensed data. We do not collect from sources whose terms prohibit it.',
          'Automated collection from any source is disabled until that source’s terms of use have been read and the review outcome recorded. This is enforced by a database constraint, not by policy alone: the automation flag cannot be set without a recorded permissive review.',
        ],
      },
      {
        heading: 'Attribution',
        body: [
          'Every record names its source and links to it. We reproduce facts, not source prose, and we do not pass off another organisation’s analysis as ours.',
        ],
      },
      {
        heading: 'If you are a source',
        body: [
          'If you administer a source we monitor and want the coverage changed — different cadence, a different contact, or removal — contact us and we will act on it.',
        ],
      },
    ],
  },
  {
    slug: 'cookies',
    title: 'Cookie Policy',
    summary: 'The cookies we set and why.',
    requiresReview: true,
    sections: [
      {
        heading: 'Strictly necessary',
        body: [
          'Session cookies keep you signed in and protect against cross-site request forgery. They are HTTP-only, secure in production, and same-site. The service cannot function without them.',
        ],
      },
      {
        heading: 'Analytics',
        body: [
          'Product analytics tell us which features are used and where members get stuck. You can opt out from your account without losing any functionality.',
          REVIEW_NOTICE,
        ],
      },
    ],
  },
  {
    slug: 'copyright',
    title: 'Copyright Policy',
    summary: 'Ownership, permitted use, and takedown requests.',
    requiresReview: true,
    sections: [
      {
        heading: 'Ownership',
        body: [
          'Facts drawn from public records are not owned by us. Our analysis, commentary, scoring and the compilation are.',
        ],
      },
      {
        heading: 'Takedown',
        body: [
          'If you believe material published here infringes your copyright, contact us with the specific URL, a description of the work, and your contact details. We will review promptly and remove material where the claim is well founded.',
          REVIEW_NOTICE,
        ],
      },
    ],
  },
  {
    slug: 'disclaimers',
    title: 'Disclaimers',
    summary:
      'General, real-estate, and funding disclaimers — read these before acting on anything.',
    requiresReview: true,
    sections: [
      {
        heading: 'General disclaimer',
        body: [
          'The Georgia Opportunity Ledger provides research and decision support. It does not provide investment, legal, tax, accounting or brokerage advice, and nothing published here should be treated as a recommendation to buy, sell, bid, borrow or apply.',
          'Scores rank opportunities against one another using a published method. They are not predictions of outcome and carry no assurance of any kind.',
        ],
      },
      {
        heading: 'Real-estate disclaimer',
        body: [
          'We are not a licensed real-estate broker and we do not represent buyers, sellers, landlords or tenants. We do not hold, show or market property, and we receive no commission on any transaction.',
          'Property information — parcel numbers, zoning, assessed values, liens, auction and registration dates — is reported from public records and can be incomplete or out of date. Tax and sheriff sales may carry redemption periods and can convey encumbered title. Obtain your own title work, survey, inspection and legal advice.',
          'Assessed value is a taxation figure, not an appraisal, and should not be treated as market value.',
        ],
      },
      {
        heading: 'Funding and financial disclaimer',
        body: [
          'We are not a lender, a loan broker, a grant writer or a financial adviser. We do not originate, arrange, guarantee or influence any funding decision.',
          'Eligibility criteria, amounts, rates and deadlines are reported from program documentation and change without notice. Only the program administrator can tell you whether you qualify, and only their published terms govern.',
          'No funding outcome is promised, implied or guaranteed by anything published here.',
          REVIEW_NOTICE,
        ],
      },
    ],
  },
];

export function findLegalDocument(slug: string): LegalDocument | null {
  return LEGAL_DOCUMENTS.find((document) => document.slug === slug) ?? null;
}
