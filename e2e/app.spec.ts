import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePack } from '../test/makePack';
import { drillFlow, importPack, SAMPLE_PACK, waitForSaved } from './flows';

// The built app (dist/, served by vite preview), with every request to another host blocked:
// the app must need nothing but its own origin. The build holds no pack: each test
// imports the synthetic sample pack, as a user would. (The file:// mode was retired in step 3.)
const APP = '/';
const sample = JSON.parse(readFileSync(SAMPLE_PACK, 'utf8'));

/** Abort any request that leaves localhost, so a network dependency fails the test. */
async function offline(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (route) => route.abort());
  return errors;
}

test('the app is one self-contained index.html with no outside references', () => {
  expect(readdirSync('dist')).toContain('index.html');
  const html = readFileSync('dist/index.html', 'utf8');
  const refs = [...html.matchAll(/<(?:script|link|img)[^>]*?(?:src|href)="([^"]*)"/g)].map((m) => m[1]);
  expect(refs.filter((r) => /^(https?:)?\/\//.test(r))).toEqual([]);
});

test('with no pack imported, the welcome screen shows', async ({ page }) => {
  const errors = await offline(page);
  await page.goto(APP);
  await expect(page.getByTestId('welcome')).toBeVisible();
  expect(errors).toEqual([]);
});

test('drill works with every other host blocked', async ({ page }) => {
  const errors = await offline(page);
  await drillFlow(page, APP);
  expect(errors).toEqual([]);
});

test('mock exam starts with the blueprint question count', async ({ page }) => {
  const errors = await offline(page);
  await importPack(page, APP);
  await page.goto(APP + '#/mock');
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  const confirmed = sample.questions.filter((q: { status: string }) => q.status !== 'unconfirmed').length;
  const expected = Math.min(sample.examBlueprint.questionCount, confirmed);
  await expect(page.getByTestId('mock-position')).toHaveText(`Question 1 of ${expected}`);
  await expect(page.getByTestId('timer')).toBeVisible();
  // Answer one, reload, and the exam resumes with the answer kept.
  await page.keyboard.press('b');
  // Saves land in IndexedDB a few ms after the answer; reload once it's there.
  await waitForSaved(page, 'docs', 'progress', 'Object.values(v?.activeMock?.answers ?? {}).some(Boolean)');
  await page.reload();
  await expect(page.getByTestId('mock-position')).toHaveText(`Question 1 of ${expected}`);
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Submit exam' }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  await expect(page.getByTestId('mock-score')).toContainText(`/ ${expected}`);
  expect(errors).toEqual([]);
});

test('sync export works and an answer survives a reload (IndexedDB)', async ({ page }) => {
  await offline(page);
  await drillFlow(page, APP);
  await page.reload();
  await page.goto(APP + '#/data');
  await expect(page.getByText('Drill · 1 topic').first()).toBeVisible();
  await page.getByRole('button', { name: 'Export sync file' }).click();
  await page.getByRole('textbox', { name: 'Device name' }).fill('Laptop');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save name and export' }).click();
  const d = await download;
  expect(d.suggestedFilename()).toMatch(/^study-sync-laptop-\d{4}-\d{2}-\d{2}\.json$/);
  const file = JSON.parse(readFileSync(await d.path(), 'utf8'));
  expect(file).toMatchObject({ kind: 'studyapp-sync', formatVersion: 2, device: 'Laptop' });
  expect(file.progress.attempts.length).toBeGreaterThanOrEqual(3);
});

test('perf: 600-question pack imports and stays fast', async ({ page }) => {
  await offline(page);
  const big = { ...makePack({ alpha: 250, beta: 150, gamma: 200 }, { groups: 10 }), packId: 'perf-pack', title: 'Perf pack' };
  const file = path.join(tmpdir(), `perf-pack-${test.info().project.name}-${test.info().repeatEachIndex}.json`);
  writeFileSync(file, JSON.stringify(big));
  await importPack(page, APP, file, 600);

  const t0 = Date.now();
  await page.goto(APP + '#/');
  await expect(page.getByText('Welcome back')).toBeVisible();
  const dashboardMs = Date.now() - t0;
  expect(dashboardMs).toBeLessThan(1000);

  await page.goto(APP + '#/drill');
  await page.getByRole('button', { name: /^All \(600\)/ }).click();
  await page.getByRole('button', { name: /Start drill/ }).click();
  const times: number[] = [];
  for (let i = 1; i <= 10; i++) {
    await expect(page.getByTestId('drill-position')).toContainText(`Question ${i} of 600`);
    await page.keyboard.press('a');
    await expect(page.getByTestId('feedback')).toBeVisible();
    const s = Date.now();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('drill-position')).toContainText(`Question ${i + 1} of 600`);
    times.push(Date.now() - s);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`perf: dashboard ${dashboardMs} ms, drill next avg ${Math.round(avg)} ms`);
  expect(avg).toBeLessThan(100);
});

test('an embedded (data: URI) figure from an imported pack renders', async ({ page }) => {
  await offline(page);
  await importPack(page, APP);
  const sc = sample.scenarios.find((s: { figure: unknown }) => s.figure);
  const q = sample.questions.find((x: { scenarioId: string | null }) => x.scenarioId === sc.id);

  await page.goto(APP + '#/drill?topics=' + q.topicIds[0]);
  await page.getByRole('button', { name: /^All \(/ }).click();
  await page.getByRole('button', { name: /Start drill/ }).click();
  // Step through the drill (order is random), waiting for each question to render, until the figure shows.
  for (let i = 1; i <= 12; i++) {
    await expect(page.getByTestId('drill-position')).toContainText(`Question ${i} of`);
    await expect(page.getByTestId('stem')).toBeVisible();
    if (await page.locator('figure img').count()) break;
    await page.keyboard.press('a');
    await expect(page.getByTestId('feedback')).toBeVisible();
    await page.keyboard.press('Enter');
  }
  const img = page.locator('figure img');
  await expect(img).toHaveCount(1);
  expect(await img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(0);
  expect(await img.getAttribute('src')).toMatch(/^data:image\/svg\+xml;base64,/);
});

test('pre-flagged questions are seeded into Flags', async ({ page }) => {
  await offline(page);
  await importPack(page, APP);
  const unconfirmed = sample.questions.filter((q: { status: string }) => q.status === 'unconfirmed');
  expect(unconfirmed.length).toBeGreaterThan(0);

  await page.goto(APP + '#/flags');
  await expect(page.getByTestId('flag-item')).toHaveCount(unconfirmed.length);
  await expect(page.getByTestId('flag-item').first()).toContainText('Pre-flagged');
  await page.getByRole('button', { name: 'Open question' }).first().click();
  await expect(page.getByTestId('unconfirmed')).toContainText('Unconfirmed — check with your notes or instructor.');
});

test('a second tab is blocked until "Use this tab instead" (Web Locks)', async ({ context }) => {
  const a = await context.newPage();
  await offline(a);
  await importPack(a, APP);
  await a.goto(APP);
  await expect(a.getByText('Welcome back')).toBeVisible();
  expect(await a.evaluate(() => typeof navigator.locks?.request)).toBe('function');

  const b = await context.newPage();
  await offline(b);
  await b.goto(APP);
  await expect(b.getByTestId('other-tab')).toBeVisible();
  await b.getByRole('button', { name: 'Use this tab instead' }).click();
  await expect(b.getByText('Welcome back')).toBeVisible();
  await expect(a.getByTestId('other-tab')).toBeVisible();
});
