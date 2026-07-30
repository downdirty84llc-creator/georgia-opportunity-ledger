import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RegisterForm } from '@/components/auth/register-form';

export const metadata: Metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
};

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-md px-4 py-14 sm:px-6">
      <h1 className="text-2xl sm:text-3xl">Create your account</h1>
      <p className="mt-2 text-sm text-ink-600">
        The free tier needs nothing but an email address. Paid plans are chosen
        after your address is confirmed.
      </p>
      <div className="mt-8">
        <Suspense>
          <RegisterForm />
        </Suspense>
      </div>
    </div>
  );
}
