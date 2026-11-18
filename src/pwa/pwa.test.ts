import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fullBleed, ICONS } from '../../scripts/make-icons';
import { manifest } from './manifest';

const ICON_DIR = path.resolve('public/icons');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

describe('web app manifest', () => {
  it('has what an installable app needs', () => {
    expect(manifest).toMatchObject({ name: 'Study', short_name: 'Study', display: 'standalone', start_url: './', scope: './' });
    expect(manifest.theme_color).toMatch(/^#[0-9A-F]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9A-F]{6}$/i);
    const sizes = manifest.icons.map((i) => `${i.sizes} ${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']));
  });

  it('every manifest icon exists with the stated pixel size', () => {
    for (const icon of manifest.icons) {
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(path.join('public', icon.src))).toEqual({ width: w, height: h });
    }
  });

  it('every generated icon (Apple icon included) exists with its size', () => {
    for (const icon of ICONS) expect(pngSize(path.join(ICON_DIR, icon.file))).toEqual({ width: icon.size, height: icon.size });
  });

  it('maskable and Apple icons are full-bleed (no transparent corners)', () => {
    const svg = readFileSync(path.join(ICON_DIR, 'app-icon.svg'), 'utf8');
    const bleed = fullBleed(svg);
    expect(bleed).not.toBe(svg);
    expect(bleed).toContain('<rect x="0" y="0" width="256" height="256"');
  });

  it('index.html has the iOS home-screen tags', () => {
    const html = readFileSync('index.html', 'utf8');
    // The manifest link is injected by vite-plugin-pwa at build time (checked in e2e/pwa.spec.ts).
    expect(html).toContain('<link rel="apple-touch-icon" href="./icons/apple-touch-icon-180.png" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toMatch(/viewport-fit=cover/);
  });
});
