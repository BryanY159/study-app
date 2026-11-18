import { expect, test } from '@playwright/test';

// PWA basics on the built app: the manifest resolves, icons load, iOS tags are present.

test('the manifest resolves, with standalone display and loadable icons', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(new URL(href!, page.url()).href);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toMatch(/manifest\+json|application\/json/);
  const m = await res.json();
  expect(m).toMatchObject({ display: 'standalone', start_url: './' });
  for (const icon of m.icons) expect((await request.get(new URL(icon.src, page.url()).href)).ok()).toBe(true);
});

test('iOS home-screen tags are present and the Apple icon loads', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await request.get(new URL(apple!, page.url()).href)).ok()).toBe(true);
  expect(await page.locator('meta[name="viewport"]').getAttribute('content')).toContain('viewport-fit=cover');
});
