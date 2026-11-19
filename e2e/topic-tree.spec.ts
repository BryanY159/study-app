import { expect, test, type Page } from '@playwright/test';
import { expandTree, importPack } from './flows';

// The collapsible group > module > topic tree on drill setup and card deck setup (Orrin sample pack:
// "First season" = Glowroots + Skyvines, "Second season" = Ember moss). Runs at phone, tablet and desktop.

const SCREENS = [
  ['drill setup', '/#/drill'],
  ['card setup', '/#/cards'],
] as const;

async function noHorizontalScroll(page: Page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, 'horizontal overflow in px').toBeLessThanOrEqual(0);
}

test.beforeEach(async ({ page }) => {
  await importPack(page, '/');
});

test('drill setup is collapsed by default and remembers what is open after a reload', async ({ page }) => {
  await page.goto('/#/drill');
  await expect(page.getByRole('checkbox', { name: 'First season' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Glowroots', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Expand First season' }).click();
  await page.getByRole('button', { name: 'Expand Glowroots' }).click();
  await expect(page.getByRole('checkbox', { name: /^Glowroot anatomy/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('checkbox', { name: /^Glowroot anatomy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse First season' })).toHaveAttribute('aria-expanded', 'true');
  // Skyvines was never opened, and Second season is still closed.
  await expect(page.getByRole('button', { name: 'Expand Skyvines' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Expand Second season' })).toHaveAttribute('aria-expanded', 'false');
});

test('unticking a topic makes its module and group partly selected, and the drill uses only what is ticked', async ({ page }) => {
  await page.goto('/#/drill');
  await expandTree(page);
  await page.getByRole('checkbox', { name: /^Glowroot light cycles/ }).uncheck();

  const partly = (name: string) => page.getByRole('checkbox', { name, exact: true }).evaluate((el) => (el as HTMLInputElement).indeterminate);
  expect(await partly('Glowroots')).toBe(true);
  expect(await partly('First season')).toBe(true);
  expect(await partly('Skyvines')).toBe(false);

  // Clear everything, then tick one topic: the start button counts exactly that topic's questions.
  // (A partly selected box selects everything on its first click, then clears on the second.)
  const firstSeason = page.getByRole('checkbox', { name: 'First season', exact: true });
  await firstSeason.click();
  await expect(firstSeason).toBeChecked();
  await firstSeason.click();
  await page.getByRole('checkbox', { name: 'Second season', exact: true }).uncheck();
  const row = page.getByTestId('tree-topic').filter({ hasText: 'Glowroot anatomy' });
  const count = Number((await row.locator('.tt-meta').textContent())!.trim());
  expect(count).toBeGreaterThan(0);
  await row.getByRole('checkbox').check();
  await expect(page.getByRole('button', { name: /Start drill/ })).toHaveText(`Start drill · ${count} question${count === 1 ? '' : 's'}`);
  await page.getByRole('button', { name: /Start drill/ }).click();
  await expect(page.getByTestId('drill-position')).toContainText(`Question 1 of ${count}`);
});

test('card setup shows due and new at every level and cascades the selection', async ({ page }) => {
  await page.goto('/#/cards');
  await expect(page.getByTestId('tree-group').first().locator('.tt-meta').first()).toContainText(/\d+ due · \d+ new/);
  const start = page.getByTestId('start-cards');
  const all = await start.textContent();
  await page.getByRole('checkbox', { name: 'First season', exact: true }).uncheck();
  await expect(start).not.toHaveText(all!);
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.getByTestId('tree-topic').first()).toContainText(/learned/);
  await page.getByRole('checkbox', { name: 'First season', exact: true }).check();
  await expect(start).toHaveText(all!);
});

test('keyboard only: Enter opens a branch, Space ticks a checkbox', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard flow runs on desktop');
  await page.goto('/#/drill');
  const chevron = page.getByTestId('tree-toggle-group').first();
  await chevron.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('checkbox', { name: 'Glowroots', exact: true })).toBeVisible();
  await expect(chevron).toBeFocused(); // focus stays on the control that was used
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'First season', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'First season', exact: true })).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: 'First season', exact: true })).toBeChecked();
});

for (const [name, url] of SCREENS) {
  test(`${name}: every row, chevron and checkbox is at least 44px, with nothing sideways`, async ({ page }) => {
    await page.goto(url);
    await expandTree(page);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.ttree button, .ttree .tt-label')]
        .filter((el) => el.offsetParent !== null)
        .map((el) => {
          const r = el.getBoundingClientRect();
          const isChevron = el.matches('.tt-chev:not(.tt-chev-named)');
          return { h: r.height, w: r.width, isChevron, label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40) };
        })
        .filter((x) => x.h < 44 || (x.isChevron && x.w < 44)),
    );
    expect(small, 'small targets').toEqual([]);
    await noHorizontalScroll(page);
  });
}
