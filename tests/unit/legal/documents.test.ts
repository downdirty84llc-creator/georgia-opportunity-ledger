import { describe, expect, it } from 'vitest';

import { FOOTER_LEGAL_HREFS } from '@/components/site/footer';
import { LEGAL_DOCUMENTS, findLegalDocument } from '@/lib/legal/documents';

/**
 * The legal set is exactly what specification 25 lists.
 *
 * This test exists because the documentation claimed twelve documents while
 * ten were shipped, for two commits, without anything noticing. A count
 * pinned in a test is harder to be wrong about than a count written in prose.
 */

const REQUIRED_SLUGS = [
  'terms',
  'privacy',
  'subscription-terms',
  'refunds',
  'editorial-standards',
  'corrections',
  'data-sources',
  'cookies',
  'copyright',
  'disclaimers',
  'acceptable-use',
  'accessibility',
] as const;

describe('the legal document set', () => {
  it('contains all twelve required documents and nothing else', () => {
    expect(LEGAL_DOCUMENTS.map((document) => document.slug).sort()).toEqual(
      [...REQUIRED_SLUGS].sort(),
    );
  });

  it('resolves every required slug', () => {
    for (const slug of REQUIRED_SLUGS) {
      expect(findLegalDocument(slug), slug).not.toBeNull();
    }
  });

  it('returns null rather than throwing on an unknown slug', () => {
    expect(findLegalDocument('does-not-exist')).toBeNull();
    expect(findLegalDocument('')).toBeNull();
    expect(findLegalDocument('../terms')).toBeNull();
  });

  it('gives every document a title, a summary and real content', () => {
    for (const document of LEGAL_DOCUMENTS) {
      expect(document.title.length, document.slug).toBeGreaterThan(3);
      expect(document.summary.length, document.slug).toBeGreaterThan(10);
      expect(document.sections.length, document.slug).toBeGreaterThan(0);

      for (const section of document.sections) {
        expect(section.heading.length, document.slug).toBeGreaterThan(2);
        expect(section.body.length, document.slug).toBeGreaterThan(0);
        for (const paragraph of section.body) {
          // Catches a section stubbed out with a placeholder and forgotten.
          expect(paragraph.trim().length, document.slug).toBeGreaterThan(30);
        }
      }
    }
  });

  /**
   * Not every document needs a lawyer. The contracts and the statements that
   * carry legal weight do; our own editorial policies are statements of how we
   * work, and sending them to counsel would be theatre. The split is
   * deliberate, so it is pinned here rather than left to whoever edits next.
   */
  const NEEDS_COUNSEL = [
    'terms',
    'privacy',
    'subscription-terms',
    'refunds',
    'cookies',
    'copyright',
    'disclaimers',
    'acceptable-use',
    'accessibility',
  ];

  const EDITORIAL_POLICY = [
    'editorial-standards',
    'corrections',
    'data-sources',
  ];

  it('marks exactly the documents that need counsel', () => {
    expect(
      LEGAL_DOCUMENTS.filter((document) => document.requiresReview)
        .map((document) => document.slug)
        .sort(),
    ).toEqual([...NEEDS_COUNSEL].sort());

    expect(
      LEGAL_DOCUMENTS.filter((document) => !document.requiresReview)
        .map((document) => document.slug)
        .sort(),
    ).toEqual([...EDITORIAL_POLICY].sort());
  });

  it('carries the review notice on every document awaiting counsel', () => {
    // The banner and the flag must agree. A document flagged for review that
    // does not say so reads as finished to whoever opens it.
    for (const document of LEGAL_DOCUMENTS) {
      const text = document.sections
        .flatMap((section) => section.body)
        .join(' ');

      if (document.requiresReview) {
        expect(text, `${document.slug} has no review notice`).toContain(
          'has not yet been reviewed by counsel',
        );
      } else {
        expect(
          text,
          `${document.slug} carries a review notice but is not flagged`,
        ).not.toContain('has not yet been reviewed by counsel');
      }
    }
  });

  it('never claims to be advice or to guarantee an outcome', () => {
    // The product is explicitly not a brokerage, lender, adviser or legal
    // service. A legal page that drifts into promising something is the one
    // place that constraint would be expensive to get wrong.
    const forbidden = [
      /\bwe guarantee\b/i,
      /\bguaranteed (approval|funding|eligibility|return)/i,
      /\bwe are (a|your) (broker|lender|attorney|adviser|advisor)\b/i,
    ];

    for (const document of LEGAL_DOCUMENTS) {
      const text = document.sections
        .flatMap((section) => section.body)
        .join(' ');
      for (const pattern of forbidden) {
        expect(pattern.test(text), `${document.slug} matched ${pattern}`).toBe(
          false,
        );
      }
    }
  });

  it('links every document from the footer', () => {
    // A legal page nobody can navigate to is a page that does not exist for
    // the person who needs it, however well it renders at its URL.
    const linked = new Set(
      FOOTER_LEGAL_HREFS.map((href) => href.replace('/legal/', '')),
    );
    for (const document of LEGAL_DOCUMENTS) {
      expect(
        linked.has(document.slug),
        `${document.slug} is not linked from the footer`,
      ).toBe(true);
    }
  });

  it('has no footer link pointing at a document that does not exist', () => {
    for (const href of FOOTER_LEGAL_HREFS) {
      const slug = href.replace('/legal/', '');
      expect(findLegalDocument(slug), href).not.toBeNull();
    }
  });

  it('uses slugs that are safe in a URL path', () => {
    for (const document of LEGAL_DOCUMENTS) {
      expect(document.slug).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(encodeURIComponent(document.slug)).toBe(document.slug);
    }
  });
});
