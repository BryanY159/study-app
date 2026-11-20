import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePack } from '../test/makePack';
import { importPack } from './flows';

// Timing limits, so this file runs alone: the perf-* projects in playwright.config.ts start only after every
// other test has finished and run one at a time. Parallel workers made the limits flaky.
const APP = '/';

/** Abort any request that leaves localhost, so a network dependency fails the test. */
async function offline(page: Page) {
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (route) => route.abort());
}

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
