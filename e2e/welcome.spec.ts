import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { importPack, SAMPLE_PACK, waitForSaved } from './flows';

test('first run: welcome → install help → import a pack → Home', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome')).toBeVisible();
  await page.getByRole('link', { name: 'Show me how' }).click();
  await expect(page.getByTestId('install-help')).toBeVisible();
  await page.goBack();
  await page.getByTestId('welcome-pack-input').setInputFiles(SAMPLE_PACK);
  await expect(page.getByText('Welcome back')).toBeVisible();
});

test('importing a newer version of the pack replaces it and keeps progress', async ({ page }) => {
  await importPack(page, '/');
  // Answer one question in a drill.
  await page.goto('/#/drill');
  await page.getByRole('button', { name: /Start drill/ }).click();
  await expect(page.getByTestId('stem')).toBeVisible();
  await page.keyboard.press('a');
  await expect(page.getByTestId('feedback')).toBeVisible();
  await page.getByRole('button', { name: /End drill/ }).click();
  await expect(page.getByText('Welcome back')).toBeVisible();
  await waitForSaved(page, 'docs', 'progress', 'v?.attempts?.length === 1');

  const v2 = { ...JSON.parse(readFileSync(SAMPLE_PACK, 'utf8')), version: 2 };
  // A unique name: projects run in parallel and must not overwrite each other's file.
  const file = path.join(tmpdir(), `sample-pack-v2-${test.info().project.name}-${test.info().repeatEachIndex}.json`);
  writeFileSync(file, JSON.stringify(v2));
  await page.goto('/#/data');
  await page.getByTestId('pack-input').setInputFiles(file);
  await expect(page.getByTestId('data-message')).toContainText('v2');
  await expect(page.getByTestId('data-message')).toContainText('replacing v1');
  await page.reload();
  await expect(page.getByText('version 2')).toBeVisible();
  await expect(page.getByText('Drill · ').first()).toBeVisible();

  // The older file is refused now.
  await page.getByTestId('pack-input').setInputFiles(SAMPLE_PACK);
  await expect(page.getByTestId('data-message')).toContainText('newer version of this pack');
});
