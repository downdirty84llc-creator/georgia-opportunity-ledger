import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CorrectionForm } from '@/components/support/correction-form';

export const metadata: Metadata = {
  title: 'Submit a correction',
  robots: { index: false, follow: false },
};

export default function NewCorrectionPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">Submit a correction</h1>
      <p className="mt-2 text-sm text-ink-600">
        If something we published is wrong, tell us. Include the source that
        contradicts us if you have it — that is usually enough for us to act the
        same day. Corrections are reviewed by an editor and, where the error was
        material, published.
      </p>
      <div className="mt-8">
        <Suspense>
          <CorrectionForm />
        </Suspense>
      </div>
    </div>
  );
}
