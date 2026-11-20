import { expect, test } from '@playwright/test';
import { importPack } from './flows';

// Results of a sectioned mock (Orrin sample pack: "First season" 3 + "Ember moss" 3 + "Study bank" 2): a score per
// section, "Drill this section" preselecting its topics, and the scores kept in the session history.
test('mock results: a score per section, Drill this section, and the history line', async ({ page }, info) => {
  test.skip(info.project.name === 'tablet', 'phone and desktop only');
  await importPack(page, '/');
  await page.goto('/#/mock');
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  await expect(page.getByTestId('mock-position')).toHaveText('Question 1 of 8');
  // On phone the question grid and Submit live in the "All questions" sheet.
  if (info.project.name === 'phone') await page.getByRole('button', { name: 'All questions' }).click();
  await page.getByRole('button', { name: 'Submit exam' }).click();
  await page.getByRole('button', { name: 'Yes, submit' }).click();

  // Nothing was answered, so every section scores 0 and none is singled out as weakest.
  await expect(page.getByTestId('mock-score')).toContainText('/ 8');
  const rows = page.getByTestId('section-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('First season: 0 / 3, 0%');
  await expect(rows.nth(1)).toContainText('Ember moss: 0 / 3, 0%');
  const noSideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(noSideways).toBeLessThanOrEqual(0);

  // "Drill this section" is a 44px-tall target on phone, and opens drill setup with only that section ticked.
  const drill = page.getByTestId('drill-section').nth(1);
  expect((await drill.boundingBox())!.height).toBeGreaterThanOrEqual(info.project.name === 'phone' ? 44 : 30);
  await drill.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Set up a drill' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Second season', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'First season', exact: true })).not.toBeChecked();

  // The scores are kept with the session: they show in History & data.
  await page.goto('/#/data');
  await expect(page.getByTestId('session-sections').first()).toHaveText('First season 0/3 · Ember moss 0/3 · Study bank 0/2');
});
