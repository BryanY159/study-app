import { expect, test, type Page } from '@playwright/test';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SAMPLE_PACK } from './flows';

// The service worker on the built app: offline after the first load, and an update
// that never interrupts a session. Service-worker inspection needs Chromium.
// Each test serves its own copy of dist/, so it can change sw.js on disk (a "new
// version") without touching the shared preview server other tests use.

test.skip(({ browserName }) => browserName !== 'chromium', 'service-worker inspection is Chromium-only in Playwright');

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };

async function serveCopy(): Promise<{ url: string; dir: string; server: Server }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyapp-sw-'));
  cpSync('dist', dir, { recursive: true });
  const server = createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel);
    if (!file.startsWith(dir)) return void res.writeHead(403).end();
    try {
      const body = readFileSync(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, dir, server };
}

async function importSample(page: Page, url: string) {
  await page.goto(url + '#/data');
  await page.getByTestId('pack-input').setInputFiles(SAMPLE_PACK);
  await expect(page.getByTestId('data-message')).toContainText('13 questions');
  await page.goto(url + '#/');
  await expect(page.getByText('Welcome back')).toBeVisible();
}

/** Wait until the service worker is installed and controls the page. */
async function swControls(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload(); // the first install controls the page from the next load on
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const hasWaiting = (page: Page) => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);

test('after the first load the app works offline: Home, the imported pack, and a drill', async ({ page, context }) => {
  const s = await serveCopy();
  try {
    await importSample(page, s.url);
    await swControls(page);

    // Offline: every network request fails. (Playwright's setOffline blocks navigations
    // before the service worker can answer them, so route-abort is used instead.)
    await context.route('**/*', (route) => route.abort('internetdisconnected'));
    await page.reload();
    await expect(page.getByText('Welcome back')).toBeVisible();
    await page.goto(s.url + '#/drill');
    await page.getByRole('button', { name: /Start drill/ }).click();
    await expect(page.getByTestId('stem')).toBeVisible();
    await page.keyboard.press('a');
    await expect(page.getByTestId('feedback')).toBeVisible();
  } finally {
    s.server.close();
  }
});

test('a new version waits during a drill, shows on Home, and Reload switches to it', async ({ page }) => {
  const s = await serveCopy();
  try {
    await importSample(page, s.url);
    await swControls(page);

    await page.goto(s.url + '#/drill');
    await page.getByRole('button', { name: /Start drill/ }).click();
    await expect(page.getByTestId('drill-position')).toBeVisible();

    // Publish a "new version" while she's mid-drill.
    const swFile = path.join(s.dir, 'sw.js');
    writeFileSync(swFile, readFileSync(swFile, 'utf8') + '\n// next version\n');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect.poll(() => hasWaiting(page)).toBe(true);

    // Mid-drill: no banner and no reload.
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
    await expect(page.getByTestId('drill-position')).toBeVisible();

    await page.getByRole('button', { name: /End drill/ }).click();
    await expect(page.getByTestId('update-banner')).toBeVisible();
    const reloaded = page.waitForEvent('load');
    await page.getByRole('button', { name: 'Reload' }).click();
    await reloaded;
    await expect(page.getByText('Welcome back')).toBeVisible();
    await expect(page.getByTestId('update-banner')).toHaveCount(0);
    await expect.poll(() => hasWaiting(page)).toBe(false);
  } finally {
    s.server.close();
  }
});
