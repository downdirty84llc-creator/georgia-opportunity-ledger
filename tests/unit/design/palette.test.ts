import { describe, expect, it } from 'vitest';

import config from '../../../tailwind.config';

/**
 * The palette, now that the brand is signed off.
 *
 * A sign-off turns these hex values from a working choice into a commitment,
 * so the contrast ladder documented in `tailwind.config.ts` stops being a
 * comment and becomes something that fails a build. It is worth pinning: an
 * earlier pass shipped `text-ink-400` as body copy at 3.7:1 across seven files
 * before the accessibility suite caught it, and a comment had not prevented
 * that.
 *
 * Ratios are computed from the committed tokens rather than hardcoded, so
 * changing a hex value moves the number and the assertion decides whether the
 * change was allowed.
 */

type Palette = Record<string, Record<string, string> | string>;

const colors = (config.theme?.extend?.colors ?? {}) as Palette;

function group(name: string): Record<string, string> {
  const value = colors[name];
  if (!value || typeof value === 'string') {
    throw new Error(`No colour group named ${name} in tailwind.config.ts`);
  }
  return value;
}

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG 2.1 contrast ratio, 1–21. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (light + 0.05) / (dark + 0.05);
}

const WHITE = '#ffffff';

/** AA for body copy. */
const BODY_TEXT = 4.5;
/** AA for large text, icons and the boundaries of interactive controls. */
const LARGE_TEXT = 3;

describe('the ink scale', () => {
  const ink = group('ink');

  it('is a monotonic ramp', () => {
    // A scale that is not ordered makes every "reach for the next one darker"
    // instinct wrong.
    const steps = Object.keys(ink)
      .map(Number)
      .sort((a, b) => a - b);
    const ratios = steps.map((step) => contrast(ink[String(step)]!, WHITE));

    for (let index = 1; index < ratios.length; index += 1) {
      expect(
        ratios[index]!,
        `ink-${steps[index]} is lighter than ink-${steps[index - 1]}`,
      ).toBeGreaterThan(ratios[index - 1]!);
    }
  });

  it('makes ink-500 and darker safe for body copy on white', () => {
    for (const step of ['500', '600', '700', '800', '900', '950']) {
      const ratio = contrast(ink[step]!, WHITE);
      expect(
        ratio,
        `ink-${step} is ${ratio.toFixed(2)}:1, below the ${BODY_TEXT}:1 floor`,
      ).toBeGreaterThanOrEqual(BODY_TEXT);
    }
  });

  it('keeps ink-400 usable for large text even though body copy is out', () => {
    // The documented ladder calls ink-400 "large text, icons, decorative".
    // That claim needs to stay true: below 3:1 it is decorative only, and the
    // comment would be wrong.
    const ratio = contrast(ink['400']!, WHITE);
    expect(ratio).toBeLessThan(BODY_TEXT);
    expect(
      ratio,
      `ink-400 is ${ratio.toFixed(2)}:1 — no longer safe even for large text`,
    ).toBeGreaterThanOrEqual(LARGE_TEXT);
  });

  it('matches the ladder written in tailwind.config.ts', () => {
    // The comment quotes figures. If a token moves, the comment is a lie
    // unless this fails first — which is not hypothetical: the comment was
    // wrong about ink-300 and ink-600 until these numbers were computed
    // rather than eyeballed.
    const ratio = (step: string) =>
      Number(contrast(ink[step]!, WHITE).toFixed(2));

    expect(ratio('300')).toBe(2.21);
    expect(ratio('400')).toBe(3.7);
    expect(ratio('500')).toBe(5.76);
    expect(ratio('600')).toBe(7.99);
    expect(ratio('700')).toBe(9.97);
  });
});

describe('the signal colours', () => {
  const signal = group('signal');

  it('carries score classifications at body-copy contrast', () => {
    // These name the score band — "Immediate Action", "Worth Investigating".
    // That is text a subscriber acts on, so it is body copy, not decoration.
    for (const [name, hex] of Object.entries(signal)) {
      const ratio = contrast(hex, WHITE);
      expect(
        ratio,
        `signal-${name} (${hex}) is ${ratio.toFixed(2)}:1 on white`,
      ).toBeGreaterThanOrEqual(BODY_TEXT);
    }
  });

  it('has a distinct colour per band', () => {
    const values = Object.values(signal);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('the clay accent', () => {
  const clay = group('clay');

  it('offers a shade safe for text on white', () => {
    // Used for the "Admin" chip and upgrade prompts, which are text.
    const safe = Object.entries(clay).filter(
      ([, hex]) => contrast(hex, WHITE) >= BODY_TEXT,
    );
    expect(safe.length, 'no clay shade reaches 4.5:1 on white').toBeGreaterThan(
      0,
    );
  });

  it('offers a shade light enough to sit behind dark text', () => {
    const backgrounds = Object.entries(clay).filter(
      ([, hex]) => contrast(hex, group('ink')['900']!) >= BODY_TEXT,
    );
    expect(
      backgrounds.length,
      'no clay shade works as a background for ink-900 text',
    ).toBeGreaterThan(0);
  });
});
