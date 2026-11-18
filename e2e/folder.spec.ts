import { expect, test, type Page } from '@playwright/test';
import { importPack } from './flows';

// Data-folder saving in a real browser. The folder picker needs a human, so it
// is replaced with the browser's private file system (OPFS): a real
// FileSystemDirectoryHandle that IndexedDB can store, exactly like a picked folder.

async function mockPicker(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle('data', { create: true });
  });
}

async function readFolderFile(page: Page, name: string): Promise<unknown> {
  return page.evaluate(async (n) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('data');
    return JSON.parse(await (await (await dir.getFileHandle(n)).getFile()).text());
  }, name);
}

test('first run: connect the data folder, answers are saved to it and survive a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockPicker(page);
  await page.goto('/');

  await expect(page.getByTestId('connect-folder')).toBeVisible();
  await page.getByRole('button', { name: 'Choose data folder' }).click();
  // A fresh browser has no data yet, so there is no backup offer (that offer is covered in ui.test.tsx).
  await expect(page.getByTestId('save-status')).toHaveText('Saved to data folder');
  await importPack(page, '/');

  await page.goto('/#/drill');
  await page.getByRole('button', { name: '10', exact: true }).click();
  await page.getByRole('button', { name: /Start drill/ }).click();
  await expect(page.getByTestId('drill-position')).toContainText('Question 1 of');
  await page.keyboard.press('a');
  await expect(page.getByTestId('feedback')).toBeVisible();
  await page.getByRole('button', { name: /End drill/ }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved to data folder');

  await expect.poll(async () => ((await readFolderFile(page, 'progress.json')) as { attempts: unknown[] }).attempts.length).toBe(1);
  const flags = (await readFolderFile(page, 'flags.json')) as { flags: { source: string }[] };
  expect(flags.flags.every((f) => f.source === 'preflag')).toBe(true);

  // Next session: the stored folder reconnects silently (permission still granted).
  await page.reload();
  await expect(page.getByTestId('save-status')).toHaveText('Saved to data folder');
  await expect(page.getByTestId('session-row')).toHaveCount(1);
  await expect(page.getByTestId('connect-folder')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('"Skip for now" keeps browser-only saving and is remembered', async ({ page }) => {
  await mockPicker(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('Saved in browser');
  await importPack(page, '/');
  await page.goto('/');
  await page.reload();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await page.goto('/#/data');
  await expect(page.getByTestId('folder-section')).toContainText('Not connected');
});
