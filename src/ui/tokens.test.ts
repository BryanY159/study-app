import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { breakpointFor } from './useBreakpoint';

const tokensCss = readFileSync('src/ui/tokens.css', 'utf8');

/** The custom properties set in one block of tokens.css (light = first :root, dark = inside the media query). */
function tokens(which: 'light' | 'dark'): Record<string, string> {
  const dark = tokensCss.indexOf('@media (prefers-color-scheme: dark)');
  const block = which === 'light' ? tokensCss.slice(0, dark) : tokensCss.slice(dark);
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]));
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background]: every text-on-surface pairing the UI uses.
const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text-2', 'surface'],
  ['muted', 'surface'],
  ['muted', 'bg'],
  ['accent', 'surface'],
  ['accent', 'bg'],
  ['accent', 'accent-tint'],
  ['on-accent', 'accent'],
  ['on-accent', 'accent-hover'],
  ['accent-soft', 'accent'],
  ['correct-ink', 'correct-tint'],
  ['correct-ink', 'correct-chip'],
  ['incorrect-ink', 'incorrect-tint'],
  ['incorrect-ink', 'incorrect-chip'],
  ['warn-ink', 'warn-tint'],
  ['warn-ink', 'warn-soft'],
  ['practice-ink', 'practice-tint'],
  ['text-2', 'chip'],
  ['incorrect', 'surface'],
  ['surface', 'correct'],
  ['surface', 'incorrect'],
];

describe('design tokens', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: every text pairing meets WCAG AA (4.5:1)`, () => {
      const t = tokens(theme);
      const failing = TEXT_PAIRS.filter(([fg, bg]) => contrast(t[fg], t[bg]) < 4.5).map(([fg, bg]) => `${fg} on ${bg}: ${contrast(t[fg], t[bg]).toFixed(2)}`);
      expect(failing).toEqual([]);
    });
  }

  it('the dark set defines every color the light set does', () => {
    const light = Object.keys(tokens('light')).sort();
    const dark = Object.keys(tokens('dark')).sort();
    expect(dark).toEqual(light);
  });

  it('no hex color anywhere in the UI outside tokens.css (dark mode is a token swap)', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(css|tsx)$/.test(f) && !/\.test\.tsx$/.test(f) && f !== 'tokens.css') files.push(p);
      }
    };
    walk('src');
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ f, i: i + 1, line }))
        // Colors only: #abc / #aabbcc in a style context, not "#/route" links or ids.
        .filter(({ line }) => /(?<![\w/&])#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b(?![\w/-])/.test(line.replace(/href=["'`][^"'`]*["'`]/g, '')))
        .map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });
});

describe('breakpoints', () => {
  it.each([
    [320, 'phone'],
    [390, 'phone'],
    [639, 'phone'],
    [640, 'tablet'],
    [820, 'tablet'],
    [1023, 'tablet'],
    [1024, 'laptop'],
    [1440, 'laptop'],
  ])('%d px → %s', (w, bp) => expect(breakpointFor(w)).toBe(bp));
});
