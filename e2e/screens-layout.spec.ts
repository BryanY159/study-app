import { expect, test } from '@playwright/test';
import { drillFlow } from './flows';

// The remaining screens at each viewport: one column on phone, nothing behind hover, no sideways scroll.

const noSideScroll = async (page: import('@playwright/test').Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test('mock results and flags: readable and usable at every size', async ({ page }) => {
  await drillFlow(page, '/');
  // A short untimed mock, submitted straight away.
  await page.goto('/#/mock');
  await page.getByRole('checkbox', { name: /timer/ }).uncheck();
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  await expect(page.getByTestId('mock-position')).toBeVisible();
  if (test.info().project.name === 'phone') await page.getByRole('button', { name: 'All questions' }).click();
  await page.getByRole('button', { name: 'Submit exam' }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();
  await expect(page.getByTestId('mock-score')).toBeVisible();
  await noSideScroll(page);

  await page.goto('/#/flags');
  await expect(page.getByRole('heading', { level: 1, name: 'Flagged questions' })).toBeVisible();
  await noSideScroll(page);
  // Every action on a flag is visible as a button (nothing appears only on hover).
  const item = page.getByTestId('flag-item').first();
  await expect(item.getByRole('button', { name: 'Open question' })).toBeVisible();
});

test('phone: the Replace confirmation shows its counts as stacked, labelled rows', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout only');
  await drillFlow(page, '/');
  // Export a sync file, then import it with Replace on the same device.
  await page.goto('/#/data');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sync file' }).click();
  await page.getByRole('textbox', { name: 'Device name' }).fill('Phone');
  await page.getByRole('button', { name: 'Save name and export' }).click();
  const file = await (await download).path();
  await page.getByTestId('sync-input').setInputFiles(file);
  await page.getByRole('radio', { name: /Replace/ }).check();
  const safety = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a safety copy and continue' }).click();
  await safety;
  const table = page.getByTestId('restore-confirm').locator('table');
  await expect(table.locator('thead')).toBeHidden();
  const label = await page.getByTestId('restore-current').locator('td[data-label="Answers"]').evaluate((td) => getComputedStyle(td, '::before').content);
  expect(label).toBe('"Answers"');
  await noSideScroll(page);
});
