import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Pill } from '@/components/ui/primitives';
import { LEGAL_DOCUMENTS, findLegalDocument } from '@/lib/legal/documents';

type PageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((document) => ({ slug: document.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const document = findLegalDocument(slug);
  if (!document) return { title: 'Not found' };
  return {
    title: document.title,
    description: document.summary,
    alternates: { canonical: `/legal/${slug}` },
  };
}

export default async function LegalPage({ params }: PageProps) {
  const { slug } = await params;
  const document = findLegalDocument(slug);
  if (!document) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <div className="grid gap-10 lg:grid-cols-[220px,1fr]">
        <nav aria-label="Legal documents" className="lg:sticky lg:top-8 lg:self-start">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-500">
            Policies
          </h2>
          <ul className="mt-3 space-y-1 text-sm">
            {LEGAL_DOCUMENTS.map((entry) => (
              <li key={entry.slug}>
                <Link
                  href={`/legal/${entry.slug}`}
                  aria-current={entry.slug === slug ? 'page' : undefined}
                  className={
                    entry.slug === slug
                      ? 'block rounded-md bg-ink-100 px-3 py-1.5 font-medium text-ink-900'
                      : 'block rounded-md px-3 py-1.5 text-ink-700 hover:bg-ink-100'
                  }
                >
                  {entry.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <article>
          <h1 className="text-3xl">{document.title}</h1>
          <p className="mt-3 text-lg text-ink-700">{document.summary}</p>

          {document.requiresReview ? (
            <p className="mt-5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong className="font-semibold">Awaiting legal review.</strong>{' '}
              This document accurately describes how the service behaves, but it
              has not yet been reviewed by counsel. Production launch is blocked
              on that review.
            </p>
          ) : (
            <div className="mt-5">
              <Pill tone="positive">Published standard</Pill>
            </div>
          )}

          <div className="mt-10 space-y-10">
            {document.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-xl">{section.heading}</h2>
                <div className="prose-ledger mt-3">
                  {section.body.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <p className="mt-12 border-t border-ink-200 pt-6 text-sm text-ink-500">
            Questions about this policy? Contact{' '}
            <Link href="/support" className="underline">
              support
            </Link>
            , or{' '}
            <Link href="/corrections/new" className="underline">
              submit a correction
            </Link>{' '}
            if something here is wrong.
          </p>
        </article>
      </div>
    </div>
  );
}
