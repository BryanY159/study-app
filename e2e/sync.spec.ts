import { expect, test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { importPack, waitForSaved } from './flows';

// Two browser contexts = two devices, each with its own IndexedDB.
// Device A answers and exports; device B imports with Merge, again (no change), then Replace.

const V14_BACKUP = path.resolve('test/fixtures/sample-pack.v1-4-backup.json');

async function device(browser: Browser) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await importPack(page, '/');
  return { context, page, errors };
}

/** Drill the first n questions of one module, answering "a". */
async function answer(page: Page, module: string, n: number) {
  await page.goto('/#/drill');
  for (const name of ['Glowroots', 'Skyvines', 'Ember moss']) {
    const box = page.getByRole('checkbox', { name, exact: true });
    if ((name === module) !== (await box.isChecked())) await box.click();
  }
  await page.getByRole('button', { name: /Start drill/ }).click();
  for (let i = 1; i <= n; i++) {
    await expect(page.getByTestId('drill-position')).toContainText(`Question ${i} of`);
    await page.keyboard.press('a');
    await expect(page.getByTestId('feedback')).toBeVisible();
    await page.keyboard.press('Enter');
  }
  await page.getByRole('button', { name: /End drill/ }).click();
  await expect(page.getByText('Welcome back')).toBeVisible();
}

async function exportFile(page: Page, label?: string): Promise<string> {
  await page.goto('/#/data');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export sync file' }).click();
  if (label) {
    await page.getByRole('textbox', { name: 'Device name' }).fill(label);
    await page.getByRole('button', { name: 'Save name and export' }).click();
  }
  return (await download).path();
}

const historyCount = async (page: Page) => {
  await page.goto('/#/data');
  await expect(page.getByRole('heading', { name: 'Session history' })).toBeVisible();
  return page.locator('section', { has: page.getByRole('heading', { name: 'Session history' }) }).locator('.list-row').count();
};

test('export on one device → Merge on another: preview, merge, and importing again adds nothing', async ({ browser }) => {
  const a = await device(browser);
  const b = await device(browser);
  await answer(a.page, 'Glowroots', 3);
  await answer(b.page, 'Skyvines', 2);
  const file = await exportFile(a.page, 'Laptop');

  await b.page.goto('/#/data');
  await b.page.getByTestId('sync-input').setInputFiles(file);
  const panel = b.page.getByTestId('sync-import');
  await expect(panel.getByTestId('sync-from')).toContainText('“Laptop”');
  await expect(panel.getByRole('radio', { name: /Merge/ })).toBeChecked();
  await expect(panel.getByTestId('merge-preview')).toContainText('+3 answers');
  await expect(panel.getByTestId('merge-preview')).toContainText('+1 session');
  await panel.getByRole('button', { name: 'Merge' }).click();
  await expect(b.page.getByTestId('data-message')).toContainText('Merged');
  expect(await historyCount(b.page)).toBe(2);

  // Same file again: nothing new.
  await b.page.getByTestId('sync-input').setInputFiles(file);
  await expect(b.page.getByTestId('merge-preview')).toContainText("nothing this device doesn't already have");
  await b.page.getByRole('button', { name: 'Merge' }).click();
  expect(await historyCount(b.page)).toBe(2);

  // Survives a reload (it's in IndexedDB).
  await b.page.reload();
  expect(await historyCount(b.page)).toBe(2);
  expect([...a.errors, ...b.errors]).toEqual([]);
  await a.context.close();
  await b.context.close();
});

test('Replace: a safety copy downloads first, then this device has exactly the file', async ({ browser }) => {
  const a = await device(browser);
  const b = await device(browser);
  await answer(a.page, 'Glowroots', 3);
  await answer(b.page, 'Skyvines', 2);
  const file = await exportFile(a.page, 'Laptop');

  await b.page.goto('/#/data');
  await b.page.getByTestId('sync-input').setInputFiles(file);
  await b.page.getByRole('radio', { name: /Replace/ }).check();
  const safety = b.page.waitForEvent('download');
  await b.page.getByRole('button', { name: 'Save a safety copy and continue' }).click();
  expect((await safety).suggestedFilename()).toMatch(/^study-sync-before-replace-/);
  await expect(b.page.getByTestId('restore-current')).toContainText('2');
  await expect(b.page.getByTestId('restore-backup')).toContainText('3');
  await b.page.getByRole('button', { name: 'Replace with this file' }).click();
  await expect(b.page.getByTestId('data-message')).toContainText('Replaced');
  expect(await historyCount(b.page)).toBe(1);
  await a.context.close();
  await b.context.close();
});

test('a v1.4 backup file imports with Merge', async ({ browser }) => {
  const b = await device(browser);
  await b.page.goto('/#/data');
  await b.page.getByTestId('sync-input').setInputFiles(V14_BACKUP);
  await expect(b.page.getByTestId('sync-from')).toContainText('older version of the app');
  await expect(b.page.getByTestId('merge-preview')).toContainText('+9 answers');
  // The pack's pre-flag is already on this device (seeded at import); the file's copy carries her comment.
  await expect(b.page.getByTestId('merge-preview')).toContainText('+1 flag');
  await expect(b.page.getByTestId('merge-preview')).toContainText('1 flag updated');
  await b.page.getByRole('button', { name: 'Merge' }).click();
  expect(await historyCount(b.page)).toBe(2);
  await b.page.goto('/#/flags');
  await expect(b.page.getByText('Option C explanation names the wrong vine.')).toBeVisible();
  await expect(b.page.getByText('Asked in class: pale yellow is right.')).toBeVisible();
  expect(b.errors).toEqual([]);
  await b.context.close();
});

test('backup reminder: shows 4 days after an export, "Not today" hides it', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-10T09:00:00') });
  await importPack(page, '/');
  await answer(page, 'Glowroots', 1);
  await expect(page.getByTestId('backup-reminder')).toContainText("haven't exported");
  await exportFile(page, 'Laptop');
  await waitForSaved(page, 'meta', 'lastExportAt', 'typeof v === "string"');
  await page.goto('/#/');
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);

  await page.clock.setSystemTime(new Date('2026-11-14T10:00:00'));
  await page.reload();
  await expect(page.getByTestId('backup-reminder')).toContainText('4 days ago');
  await page.getByRole('button', { name: 'Not today' }).click();
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
  await waitForSaved(page, 'meta', 'reminderSnoozedUntil', 'typeof v === "string"');
  await page.reload();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
});
