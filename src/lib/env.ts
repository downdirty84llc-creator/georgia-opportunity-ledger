/**
 * Environment access.
 *
 * Server-only secrets are read through `serverEnv()`, which throws if called
 * in a browser bundle. Anything the browser genuinely needs is in
 * `publicEnv` and is prefixed NEXT_PUBLIC_ so the boundary is visible in the
 * name rather than only in this file.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'See .env.example for the full list.',
    );
  }
  return value;
}

export const publicEnv = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  environment: (process.env.NEXT_PUBLIC_ENVIRONMENT ?? 'development') as
    'development' | 'staging' | 'production',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  stripePublishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
  posthogKey: process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '',
  posthogHost: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '',
} as const;

export const isProduction = publicEnv.environment === 'production';

export interface ServerEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  emailProvider: 'resend' | 'postmark' | 'console';
  emailApiKey: string;
  emailFrom: string;
  emailReplyTo: string;
  cronSecret: string;
  storageBuckets: {
    reports: string;
    attachments: string;
    exports: string;
  };
  maxUploadBytes: number;
}

export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() must not be called from client code');
  }

  return {
    supabaseUrl: required(
      'NEXT_PUBLIC_SUPABASE_URL',
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    supabaseAnonKey: required(
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    supabaseServiceRoleKey: required(
      'SUPABASE_SERVICE_ROLE_KEY',
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),

    // Required when Stripe is actually used, not when the environment is read.
    //
    // Eleven modules call serverEnv(); three touch Stripe. Demanding these up
    // front meant an unconfigured payment provider took down everything that
    // reads any server variable at all — the job runner, which contains no
    // Stripe reference, returned 500 for that reason alone.
    //
    // Getters rather than optional fields: the type stays `string`, every call
    // site is unchanged, and reaching for a key that is not configured still
    // fails immediately with the same message. What changes is only *when* —
    // at the point of use, by the code that needs it, instead of at boot by
    // code that does not.
    get stripeSecretKey(): string {
      return required('STRIPE_SECRET_KEY', process.env.STRIPE_SECRET_KEY);
    },
    get stripeWebhookSecret(): string {
      return required(
        'STRIPE_WEBHOOK_SECRET',
        process.env.STRIPE_WEBHOOK_SECRET,
      );
    },
    emailProvider: (process.env.EMAIL_PROVIDER ?? 'console') as
      'resend' | 'postmark' | 'console',
    emailApiKey: process.env.EMAIL_API_KEY ?? '',
    emailFrom:
      process.env.EMAIL_FROM ??
      'Georgia Opportunity Ledger <no-reply@localhost>',
    emailReplyTo: process.env.EMAIL_REPLY_TO ?? '',
    cronSecret: required('CRON_SECRET', process.env.CRON_SECRET),
    storageBuckets: {
      reports: process.env.SUPABASE_STORAGE_BUCKET_REPORTS ?? 'reports',
      attachments:
        process.env.SUPABASE_STORAGE_BUCKET_ATTACHMENTS ?? 'attachments',
      exports: process.env.SUPABASE_STORAGE_BUCKET_EXPORTS ?? 'exports',
    },
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 26_214_400),
  };
}
