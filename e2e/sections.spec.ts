import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importPack, SAMPLE_PACK } from './flows';

// Mock exam sections (v2.1.0), against the Orrin sample pack: "First season" 3 + "Ember moss" 3 + "Study bank" 2.
const sample = JSON.parse(readFileSync(SAMPLE_PACK, 'utf8'));

/** Start a mock and walk through it, recording for each question whether it shows a scenario. */
async function walkMock(page: import('@playwright/test').Page, total: number) {
  await page.goto('/#/mock');
  await page.getByRole('button', { name: 'Start mock exam' }).click();
  await expect(page.getByTestId('mock-position')).toHaveText(`Question 1 of ${total}`);
  const scenario: boolean[] = [];
  for (let i = 1; i <= total; i++) {
    await expect(page.getByTestId('mock-position')).toHaveText(`Question ${i} of ${total}`);
    scenario.push(await page.getByTestId('scenario').isVisible());
    if (i < total) await page.keyboard.press('ArrowRight');
  }
  return scenario;
}

test('a sectioned mock draws each section and keeps the scenario set together, with no warning', async ({ page }) => {
  await importPack(page, '/');
  const scenario = await walkMock(page, 8);
  // Ember moss' three questions share one scenario and sit side by side.
  expect(scenario.filter(Boolean)).toHaveLength(3);
  const first = scenario.indexOf(true);
  expect(scenario.slice(first, first + 3)).toEqual([true, true, true]);
  await expect(page.locator('.banner.warn')).toHaveCount(0);
});

test('a section that cannot be filled shows a warning on the mock', async ({ page }) => {
  const short = structuredClone(sample);
  short.examBlueprint.questionCount = 10;
  short.examBlueprint.sections[1].count = 5; // only 3 Ember moss questions are available
  const file = path.join(tmpdir(), `sections-short-${test.info().project.name}-${test.info().repeatEachIndex}.json`);
  writeFileSync(file, JSON.stringify(short));
  await importPack(page, '/', file);
  await walkMock(page, 8);
  await expect(page.locator('.banner.warn').first()).toContainText('Only 3 Ember moss questions available (the exam blueprint asks for 5)');
});
