import { expect, test } from '@playwright/test';
import { importPack, skipFolderSetup } from './flows';

// C-2: only one tab saves. Real Web Locks in Chromium (the unit test uses a fake).
test('a second tab shows "already open"; "Use this tab instead" moves saving to it', async ({ context }) => {
  const a = await context.newPage();
  await skipFolderSetup(a);
  await importPack(a, '/');
  await a.goto('/');
  await expect(a.getByText('Welcome back')).toBeVisible();

  const b = await context.newPage();
  await skipFolderSetup(b);
  await b.goto('/');
  await expect(b.getByText('This app is already open in another tab')).toBeVisible();

  await b.getByRole('button', { name: 'Use this tab instead' }).click();
  await expect(b.getByText('Welcome back')).toBeVisible();
  await expect(a.getByTestId('other-tab')).toBeVisible();
});
