import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importPack } from './flows';

// First start of v1.5 on a browser that used v1.4: its localStorage docs move into
// IndexedDB once, and the old keys are left exactly as they were.

const v14 = JSON.parse(readFileSync('test/fixtures/sample-pack.v1-4-backup.json', 'utf8'));

test('v1.4 data in localStorage moves to IndexedDB once; the old keys are never written', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Seed exactly once, before the app's first start (not on every navigation).
  await page.goto('/spike/storage.html');
  await page.evaluate(
    ([p, f]) => {
      localStorage.setItem('studyapp:progress', p);
      localStorage.setItem('studyapp:flags', f);
    },
    [JSON.stringify(v14.progress), JSON.stringify(v14.flags)],
  );
  const before = await page.evaluate(() => [localStorage.getItem('studyapp:progress'), localStorage.getItem('studyapp:flags')]);

  await importPack(page, '/');
  await page.goto('/#/data');
  const rows = page.locator('section', { has: page.getByRole('heading', { name: 'Session history' }) }).locator('.list-row');
  await expect(rows).toHaveCount(2);
  await page.goto('/#/flags');
  await expect(page.getByText('Asked in class: pale yellow is right.')).toBeVisible();

  // The old keys are untouched; then clear them: the data is still there (it's in IndexedDB now).
  const after = await page.evaluate(() => [localStorage.getItem('studyapp:progress'), localStorage.getItem('studyapp:flags')]);
  expect(after).toEqual(before);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.goto('/#/data');
  await expect(rows).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('a fresh browser starts empty, with no data-folder screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await expect(page.getByText(/data folder/i)).toHaveCount(0);
});
