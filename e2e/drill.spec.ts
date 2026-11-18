import { expect, test } from '@playwright/test';
import { drillFlow } from './flows';

test('drill flow', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await drillFlow(page, '/');
  expect(errors).toEqual([]);
});
