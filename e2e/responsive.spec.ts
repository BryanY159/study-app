import { expect, test, type Page } from '@playwright/test';
import { importPack } from './flows';

// Layout checks at each viewport (projects: phone, tablet, desktop).

// Each screen with the heading that proves it has rendered (hash changes don't reload the page).
const SCREENS: [string, string][] = [
  ['#/', 'Welcome back'],
  ['#/drill', 'Set up a drill'],
  ['#/cards', 'Flashcards'],
  ['#/mock', 'Mock exam'],
  ['#/flags', 'Flagged questions'],
  ['#/data', 'History & data'],
  ['#/install', 'Install the app'],
];

async function open(page: Page, hash: string, heading: string) {
  await page.goto('/' + hash);
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
}

async function noHorizontalScroll(page: Page, where: string) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll, `horizontal scroll on ${where}`).toBeLessThanOrEqual(inner);
}

test('navigation: a bottom tab bar on phone, the top nav otherwise', async ({ page }, info) => {
  await importPack(page, '/');
  await page.goto('/#/');
  await expect(page.getByText('Welcome back')).toBeVisible();
  const phone = info.project.name === 'phone';
  await expect(page.getByTestId('tabbar')).toHaveCount(phone ? 1 : 0);
  await expect(page.locator('header nav[aria-label="Main"]')).toHaveCount(phone ? 0 : 1);

  if (phone) {
    await page.getByTestId('tabbar').getByRole('link', { name: 'Drill' }).click();
    await expect(page).toHaveURL(/#\/drill$/);
    await page.getByTestId('tabbar').getByRole('button', { name: 'More' }).click();
    const sheet = page.getByRole('dialog', { name: 'More' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('link', { name: 'History & data' }).click();
    await expect(page.getByRole('heading', { name: 'History & data' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'More' })).toHaveCount(0);
    // The tab bar never covers content: the page has room at the bottom for it.
    const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.body).paddingBottom));
    expect(pad).toBeGreaterThanOrEqual(60);
  } else {
    await page.locator('header nav').getByRole('link', { name: 'History & data' }).click();
    await expect(page.getByRole('heading', { name: 'History & data' })).toBeVisible();
  }
});

test('no screen scrolls sideways', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await noHorizontalScroll(page, 'welcome');
  await importPack(page, '/');
  for (const [s, h] of SCREENS) {
    await open(page, s, h);
    await noHorizontalScroll(page, s);
  }
});

test('touch targets are at least 44px tall on phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout only');
  await importPack(page, '/');
  for (const [s, h] of SCREENS) {
    await open(page, s, h);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('button, .btn, .tabbar a, [role="radio"], input[type="checkbox"]')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          // A checkbox counts by its clickable label row.
          const target = el.matches('input[type="checkbox"]') ? (el.closest('label') ?? el) : el;
          return { h: target.getBoundingClientRect().height, label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40) };
        })
        .filter((x) => x.h < 44),
    );
    expect(small, `small targets on ${s}`).toEqual([]);
  }
});

test('dark mode follows the system setting, with no hard-coded light background', async ({ browser }, info) => {
  const context = await browser.newContext({ ...info.project.use, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  const colors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector('.card')!).backgroundColor,
    text: getComputedStyle(document.body).color,
  }));
  expect(colors.body).toBe('rgb(16, 21, 27)');
  expect(colors.card).toBe('rgb(24, 32, 41)');
  expect(colors.text).toBe('rgb(231, 236, 241)');
  await context.close();
});
