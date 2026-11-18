import { expect, test } from '@playwright/test';
import { importPack } from './flows';

// Mock exam layout: a slide-up question grid on phone, a side column on tablet and laptop.

test('phone: grid in a slide-up sheet — jump to a question, mark it, submit', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout only');
  await importPack(page, '/');
  await page.goto('/#/mock');
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  await expect(page.getByTestId('mock-position')).toHaveText(/Question 1 of \d+/);
  await expect(page.getByTestId('navgrid')).toHaveCount(0);

  // Timer and position stay visible while scrolled.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByTestId('timer')).toBeInViewport();
  await expect(page.getByTestId('mock-position')).toBeInViewport();

  await page.getByRole('button', { name: 'All questions' }).click();
  const sheet = page.getByRole('dialog', { name: 'All questions' });
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Question 3', exact: true }).tap();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('mock-position')).toHaveText(/Question 3 of/);

  const bar = page.getByTestId('bottom-bar');
  await bar.getByRole('button', { name: 'Mark' }).tap();
  await expect(bar.getByRole('button', { name: 'Marked' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.option').first().tap();
  await bar.getByRole('button', { name: 'Next question' }).tap();
  await expect(page.getByTestId('mock-position')).toHaveText(/Question 4 of/);

  await page.getByRole('button', { name: 'All questions' }).click();
  await expect(sheet.getByRole('button', { name: 'Question 3, answered, marked' })).toBeVisible();
  // Esc and "Back to question" close it.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'All questions' }).click();
  await sheet.getByRole('button', { name: 'Submit exam' }).tap();
  await sheet.getByRole('button', { name: 'Yes, submit' }).tap();
  await expect(page.getByTestId('mock-score')).toBeVisible();
});

test('tablet and laptop: the grid is always visible beside the question', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'tablet and laptop layout');
  await importPack(page, '/');
  await page.goto('/#/mock');
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  const grid = page.getByTestId('navgrid');
  await expect(grid).toBeVisible();
  const q = (await page.locator('.mock-layout > section').boundingBox())!;
  const g = (await grid.boundingBox())!;
  expect(g.x).toBeGreaterThan(q.x + q.width - 1); // beside, not below
  await grid.getByRole('button', { name: 'Question 2', exact: true }).click();
  await expect(page.getByTestId('mock-position')).toHaveText(/Question 2 of/);
  await expect(page.getByTestId('bottom-bar')).toHaveCount(0);
});
