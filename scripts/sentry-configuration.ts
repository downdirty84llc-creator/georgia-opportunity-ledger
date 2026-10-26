import { parseSentryDsn } from '../src/lib/observability/sentry-dsn';

/** Checks configuration only; does not send an event or claim alert receipt. */
export function sentryConfigurationCheck(dsn: string) {
  if (!dsn) {
    return { status: 'fail' as const, detail: 'SENTRY_DSN unset' };
  }
  if (!parseSentryDsn(dsn)) {
    return {
      status: 'fail' as const,
      detail:
        'SENTRY_DSN malformed — copy the complete HTTP(S) DSN with its public key and numeric project ID',
    };
  }
  return {
    status: 'pass' as const,
    detail: 'valid DSN format; event delivery and alert receipt not verified',
  };
}
