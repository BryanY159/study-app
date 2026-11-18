import { expect, test } from '@playwright/test';

// The iOS storage spike page (public/spike/). This only checks the page itself works;
// whether iOS keeps the data is what the manual spike in spike/ios-storage.md finds out.

test('spike page saves a numbered visit in both stores and lists earlier ones after a reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/spike/storage.html');
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await expect(page.getByTestId('visit-number')).toHaveText('1');
  await expect(page.getByTestId('mode')).toHaveText('browser tab');
  await expect(page.getByTestId('idb-visits').locator('tr')).toHaveCount(1);
  await expect(page.getByTestId('ls-visits').locator('tr')).toHaveCount(1);

  await page.reload();
  await expect(page.locator('body[data-ready="true"]')).toBeAttached();
  await expect(page.getByTestId('visit-number')).toHaveText('2');
  await expect(page.getByTestId('idb-visits').locator('tr')).toHaveCount(2);
  await expect(page.getByTestId('ls-visits').locator('tr')).toHaveCount(2);
  await expect(page.getByTestId('status')).toHaveText('');
  expect(errors).toEqual([]);
});

test('spike page links a standalone manifest that iOS can use', async ({ page, request }) => {
  await page.goto('/spike/storage.html');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('./manifest.webmanifest');
  const res = await request.get('/spike/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ display: 'standalone', start_url: './storage.html', scope: './' });
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
});
