import type { Metadata } from 'next';

import { ButtonLink } from '@/components/ui/primitives';

export const metadata: Metadata = {
  title: 'Email preferences updated',
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function UnsubscribedPage({ searchParams }: PageProps) {
  const { status } = await searchParams;
  const succeeded = status === 'ok';

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      {succeeded ? (
        <>
          <h1 className="text-2xl sm:text-3xl">You are unsubscribed</h1>
          <p className="mt-4 text-ink-700">
            We have switched off alert and marketing email for your account. You
            will still receive essential account and billing messages — a failed
            payment, a password reset — because those are not marketing.
          </p>
          <p className="mt-4 text-sm text-ink-600">
            Nothing else changed. Your subscription, saved opportunities, notes
            and searches are all exactly as they were, and you can turn email
            back on whenever you want.
          </p>
        </>
      ) : (
        <>
          <h1 className="text-2xl sm:text-3xl">That link did not work</h1>
          <p className="mt-4 text-ink-700">
            The unsubscribe link was invalid or has been altered. You can change
            every email setting from your account instead, and support can do it
            for you if that is easier.
          </p>
        </>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/account/email-preferences">
          Manage email preferences
        </ButtonLink>
        <ButtonLink href="/support" variant="secondary">
          Contact support
        </ButtonLink>
      </div>
    </div>
  );
}
