import { describe, expect, it } from 'vitest';

import {
  assertModeMatchesEnvironment,
  modeOf,
} from '../../../scripts/stripe-mode';

/**
 * The Stripe key says which mode the ids come from. It says nothing about which
 * database receives them, and this project has already shipped plan rows
 * pointing at prices from the wrong Stripe account — invisible in every listing
 * until a real checkout answered "No such price".
 *
 * These tests exist because a guard nobody has watched refuse is not a guard.
 * The live/production pairing must pass and each mismatch must throw; a test
 * that only asserted the happy path would pass against a function that never
 * refused anything at all.
 */

// Deliberately too short to be mistaken for a real credential. An earlier
// version used realistic-length placeholders and GitHub's push protection
// rejected the commit — correctly, since a scanner cannot tell a convincing
// fake from the real thing. These retain the key's prefix and character shape
// without resembling a usable credential.
const TEST_KEY = 'sk_test_fake';
const LIVE_KEY = 'sk_live_fake';

describe('modeOf', () => {
  it('recognises secret and restricted key modes', () => {
    expect(modeOf(LIVE_KEY)).toBe('live');
    expect(modeOf(TEST_KEY)).toBe('test');
    expect(modeOf('rk_live_fake')).toBe('live');
    expect(modeOf('rk_test_fake')).toBe('test');
    expect(modeOf('rkcs_test_fake')).toBe('test');
  });

  it.each(['mk_fake', 'pk_test_fake', '', 'sk_test_', 'sk_live_fake\n'])(
    'refuses unsupported or malformed key %j',
    (key) => expect(() => modeOf(key)).toThrow(/Unrecognised Stripe key/),
  );
});

describe('assertModeMatchesEnvironment', () => {
  it('allows a live key against production', () => {
    expect(() =>
      assertModeMatchesEnvironment(LIVE_KEY, 'production'),
    ).not.toThrow();
  });

  it.each(['development', 'staging'])(
    'allows a test key against %s',
    (environment) => {
      expect(() =>
        assertModeMatchesEnvironment(TEST_KEY, environment),
      ).not.toThrow();
    },
  );

  it('refuses a test key against production', () => {
    // The expensive direction: test price ids written onto live plans, failing
    // at the till rather than at deploy time.
    expect(() => assertModeMatchesEnvironment(TEST_KEY, 'production')).toThrow(
      /TEST price ids into the production database/,
    );
  });

  it.each(['development', 'staging'])(
    'refuses a live key against %s',
    (environment) => {
      expect(() => assertModeMatchesEnvironment(LIVE_KEY, environment)).toThrow(
        /LIVE Stripe catalogue/,
      );
    },
  );

  it.each(['development', 'staging'])(
    'refuses a live restricted key against %s before catalogue writes',
    (environment) => {
      expect(() =>
        assertModeMatchesEnvironment('rk_live_fake', environment),
      ).toThrow(/LIVE Stripe catalogue/);
    },
  );

  it('allows a live restricted key only against production', () => {
    expect(() =>
      assertModeMatchesEnvironment('rk_live_fake', 'production'),
    ).not.toThrow();
    expect(() =>
      assertModeMatchesEnvironment('rk_test_fake', 'production'),
    ).toThrow(/TEST price ids into the production database/);
  });

  it('refuses an unknown environment before catalogue writes', () => {
    expect(() => assertModeMatchesEnvironment(TEST_KEY, 'prodution')).toThrow(
      /Unsupported NEXT_PUBLIC_ENVIRONMENT/,
    );
  });

  it('refuses an unset environment rather than assuming one', () => {
    // Same reasoning as seed.ts: the dangerous operator is the one who never
    // set it while the Supabase URL points at production. Defaulting is what
    // made the equivalent guard in seed.ts useless.
    expect(() => assertModeMatchesEnvironment(LIVE_KEY, undefined)).toThrow(
      /NEXT_PUBLIC_ENVIRONMENT is not set/,
    );
    expect(() => assertModeMatchesEnvironment(TEST_KEY, '')).toThrow(
      /NEXT_PUBLIC_ENVIRONMENT is not set/,
    );
  });

  it('refuses a managed key against production', () => {
    // An mk_ key is an id, not a usable secret, and would otherwise be treated
    // as a test key and blocked only by luck. Blocked explicitly here.
    expect(() => assertModeMatchesEnvironment('mk_fake', 'production')).toThrow(
      /Unrecognised Stripe key/,
    );
  });
});
