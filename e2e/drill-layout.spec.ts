import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makePack } from '../test/makePack';
import { importPack } from './flows';

// The drill at each viewport: by touch on phone and tablet, by keyboard on desktop.
// On phone, Flag and Next sit in a bar fixed to the bottom, even with a long question.

test('drill: answer by tap (phone, tablet) or key (desktop), feedback shows, Next moves on', async ({ page }, info) => {
  await importPack(page, '/');
  await page.goto('/#/drill');
  await page.getByRole('button', { name: /Start drill/ }).click();
  await expect(page.getByTestId('drill-position')).toContainText('Question 1 of');
  const desktop = info.project.name === 'desktop';
  if (desktop) await page.keyboard.press('a');
  else await page.locator('.option').first().tap();
  await expect(page.getByTestId('feedback')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/Correct|Incorrect/);
  const next = page.getByRole('button', { name: /Next question/ });
  await expect(next).toBeVisible();
  if (desktop) await page.keyboard.press('Enter');
  else await next.tap();
  await expect(page.getByTestId('drill-position')).toContainText('Question 2 of');
  await expect(page.getByTestId('bottom-bar')).toHaveCount(info.project.name === 'phone' ? 1 : 0);
});

test('phone: the bottom bar stays on screen with a long question, and Next appears only after answering', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout only');
  const pack = makePack({ a: 3 });
  const long = 'This invented question goes on for a while so that it fills more than one phone screen. '.repeat(14);
  pack.questions = pack.questions.map((q) => ({ ...q, stem: long + q.stem }));
  const file = path.join(tmpdir(), `long-pack-${test.info().repeatEachIndex}.json`);
  writeFileSync(file, JSON.stringify(pack));
  await importPack(page, '/', file, 3);
  await page.goto('/#/drill');
  await page.getByRole('button', { name: /Start drill/ }).click();
  const bar = page.getByTestId('bottom-bar');
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('button', { name: /Next/ })).toHaveCount(0);
  const viewport = page.viewportSize()!;
  const atBottom = async () => {
    const box = (await bar.boundingBox())!;
    expect(Math.round(box.y + box.height)).toBe(viewport.height);
  };
  await atBottom();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await atBottom();
  await page.locator('.option').last().tap();
  await expect(bar.getByRole('button', { name: /Next question/ })).toBeVisible();
  await atBottom();
  // The last option is not hidden behind the bar.
  await page.locator('.option').last().scrollIntoViewIfNeeded();
  const opt = (await page.locator('.option').last().boundingBox())!;
  expect(opt.y + opt.height).toBeLessThanOrEqual((await bar.boundingBox())!.y + 1);
});

test('FR-16: look back at an earlier question from the strip, read-only, then back to the current one', async ({ page }, info) => {
  await importPack(page, '/');
  await page.goto('/#/drill');
  await page.getByRole('button', { name: /Start drill/ }).click();
  const desktop = info.project.name === 'desktop';
  for (let i = 1; i <= 3; i++) {
    await expect(page.getByTestId('drill-position')).toContainText(`Question ${i} of`);
    await expect(page.getByTestId('stem')).toBeVisible();
    await page.keyboard.press('a');
    await expect(page.getByTestId('feedback')).toBeVisible();
    if (i < 3) await page.keyboard.press('Enter');
  }
  const liveStem = await page.getByTestId('stem').textContent();
  const strip = page.getByTestId('question-strip');
  await expect(strip.getByRole('button', { name: /^Question 4,/ })).toBeDisabled();

  if (desktop) {
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
  } else {
    await strip.getByRole('button', { name: /^Question 1,/ }).tap();
  }
  await expect(page.getByTestId('reviewing')).toContainText('question 1');
  await expect(page.getByTestId('feedback')).toBeVisible();
  await expect(page.getByRole('radiogroup')).toHaveCount(0);
  expect(await page.getByTestId('stem').textContent()).not.toBe(liveStem);

  await page.getByRole('button', { name: 'Back to current question' }).click();
  await expect(page.getByTestId('reviewing')).toHaveCount(0);
  expect(await page.getByTestId('stem').textContent()).toBe(liveStem);
  await expect(page.getByTestId('drill-position')).toContainText('Question 3 of');
  await expect(page.getByText('correct so far')).toContainText('of 3 correct so far');
});
