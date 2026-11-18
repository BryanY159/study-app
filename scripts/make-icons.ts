// Renders the PWA icons from public/icons/app-icon.svg (the approved app icon).
// Uses the Playwright Chromium the e2e tests already install: no image library needed.
// Run:  npx tsx scripts/make-icons.ts   (the PNGs are committed; re-run after changing the SVG)

import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/icons');
const svg = readFileSync(path.join(DIR, 'app-icon.svg'), 'utf8');

/**
 * Full-bleed version for maskable and Apple icons: the platform applies its own
 * mask or rounding, so the background must reach every edge (no transparent corners).
 * The card artwork sits well inside the central 80% safe zone already.
 */
export function fullBleed(src: string): string {
  return src.replace(/<rect x="8" y="8" width="240" height="240" rx="56" fill="(#[0-9A-Fa-f]{6})"\/>/, '<rect x="0" y="0" width="256" height="256" fill="$1"/>');
}

export const ICONS = [
  { file: 'icon-192.png', size: 192, bleed: false },
  { file: 'icon-512.png', size: 512, bleed: false },
  { file: 'icon-maskable-512.png', size: 512, bleed: true },
  { file: 'apple-touch-icon-180.png', size: 180, bleed: true },
] as const;

async function main() {
  if (fullBleed(svg) === svg) throw new Error('app-icon.svg changed shape: update fullBleed()');
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const icon of ICONS) {
    const src = icon.bleed ? fullBleed(svg) : svg;
    await page.setViewportSize({ width: icon.size, height: icon.size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><img style="display:block;width:${icon.size}px;height:${icon.size}px" src="data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}"></body></html>`,
    );
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    writeFileSync(path.join(DIR, icon.file), await page.screenshot({ omitBackground: !icon.bleed, clip: { x: 0, y: 0, width: icon.size, height: icon.size } }));
    console.log(`wrote public/icons/${icon.file}`);
  }
  await browser.close();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
