/**
 * Which Stripe mode a key opens, and whether that agrees with the database the
 * ids are about to be written to.
 *
 * Its own module rather than part of `stripe-setup.ts` so it can be imported
 * and tested without running the setup script, which executes on import.
 */

export type StripeMode = 'live' | 'test';

export function modeOf(secretKey: string): StripeMode {
  return secretKey.startsWith('sk_live_') ? 'live' : 'test';
}

/**
 * The key decides which Stripe mode is written; `NEXT_PUBLIC_SUPABASE_URL`
 * decides which database receives the ids. Nothing previously required those
 * two to agree, and they disagree exactly when it is most expensive:
 *
 *   - a `sk_test_` key against the production database writes **test** price
 *     ids onto the live plans. Checkout then fails for every real customer with
 *     "No such price", and it fails at the till rather than at deploy time.
 *   - a `sk_live_` key against a development database builds the real
 *     catalogue from somebody's laptop and hands the dev environment live ids.
 *
 * A price id is only meaningful in the mode that minted it, and this project
 * has already shipped plan rows pointing at ids from the wrong Stripe account
 * once. So the two must be stated and must match.
 */
export function assertModeMatchesEnvironment(
  secretKey: string,
  environment: string | undefined,
): void {
  // Unset is refused for the same reason it is in seed.ts: the dangerous
  // operator is not the one who sets this wrongly, it is the one who never
  // sets it while the Supabase URL points at production.
  if (!environment) {
    throw new Error(
      'NEXT_PUBLIC_ENVIRONMENT is not set.\n' +
        '  Set it explicitly (development | staging | production) so the Stripe\n' +
        '  mode can be checked against the database being written to.',
    );
  }

  const mode = modeOf(secretKey);

  if (environment === 'production' && mode !== 'live') {
    throw new Error(
      'Refusing to write TEST price ids into the production database.\n' +
        '  STRIPE_SECRET_KEY is a test key but NEXT_PUBLIC_ENVIRONMENT=production.\n' +
        '  Live checkout would fail with "No such price" for every real customer.',
    );
  }

  if (environment !== 'production' && mode === 'live') {
    throw new Error(
      `Refusing to build the LIVE Stripe catalogue from a ${environment} environment.\n` +
        '  STRIPE_SECRET_KEY is a live key but NEXT_PUBLIC_ENVIRONMENT is not\n' +
        '  production. Set it to production if that is genuinely what you mean.',
    );
  }
}
