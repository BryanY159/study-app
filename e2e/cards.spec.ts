import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { importPack, SAMPLE_PACK } from './flows';

// Flashcards at each viewport, on the Orrin fixture's 10 invented cards.

/** A horizontal drag on the card (pointer events, as a finger or mouse would send). */
async function swipe(page: Page, dx: number) {
  await page.getByTestId('flashcard').evaluate((el, d) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const fire = (type: string, cx: number) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: cx, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true }));
    fire('pointerdown', x);
    fire('pointermove', x + d / 2);
    fire('pointermove', x + d);
    fire('pointerup', x + d);
  }, dx);
}

async function startDeck(page: Page, mode = 'Due + new') {
  await importPack(page, '/');
  await page.goto('/#/cards');
  await page.getByRole('radio', { name: new RegExp(mode.replace('+', '\\+')) }).check();
  await page.getByTestId('start-cards').click();
  await expect(page.getByTestId('flashcard')).toBeVisible();
}

test('phone: tap to flip, swipe right = Got it, a swipe before flipping does nothing', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone gestures');
  await startDeck(page);
  await expect(page.getByTestId('card-position')).toHaveText(/Card 1 of 10/);
  await swipe(page, 200); // not flipped yet: ignored
  await expect(page.getByTestId('card-position')).toHaveText(/Card 1 of 10/);
  await expect(page.getByTestId('card-front')).toBeVisible();
  await page.getByTestId('flashcard').tap();
  await expect(page.getByTestId('card-back')).toBeVisible();
  await expect(page.getByText('Or swipe: ← Again · Got it →')).toBeVisible();
  await swipe(page, 200);
  await expect(page.getByTestId('card-position')).toHaveText(/Card 2 of 10/);
  // Buttons work too, in the bottom bar.
  const bar = page.getByTestId('bottom-bar');
  await bar.getByRole('button', { name: 'Show answer' }).tap();
  await bar.getByRole('button', { name: /^Again/ }).tap();
  await expect(page.getByTestId('card-position')).toHaveText(/Card 3 of 11/); // Again re-queues
});

test('desktop: a whole session by keyboard, then the summary', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard session');
  await startDeck(page);
  for (let i = 0; i < 10; i++) {
    await expect(page.getByTestId('card-front')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('card-back')).toBeVisible();
    await page.keyboard.press(i === 0 ? '1' : '2'); // first one Again
  }
  // The card rated Again comes back once more.
  await page.keyboard.press('Space');
  await page.keyboard.press('2');
  const summary = page.getByTestId('card-summary');
  await expect(summary).toBeVisible();
  await expect(summary.getByTestId('summary-reviewed')).toHaveText('10');
  await expect(summary.getByTestId('summary-first-try')).toHaveText('90%');
  await expect(summary.getByTestId('summary-next')).toContainText('tomorrow');
  await expect(page.getByText('Space flips · 1 Again · 2 Got it')).toHaveCount(0); // side panel gone with the session
});

test('tablet: the diagram card shows its image and labels, the asked-about one highlighted', async ({ page }, info) => {
  test.skip(info.project.name !== 'tablet', 'tablet layout');
  await importPack(page, '/');
  await page.goto('/#/cards');
  for (const t of ['Term', 'Concept', 'Fill in the blank']) await page.getByRole('button', { name: t }).click();
  await page.getByTestId('start-cards').click();
  const card = page.getByTestId('flashcard');
  await expect(card.getByTestId('card-type')).toHaveText('Diagram');
  const img = card.locator('img');
  await expect(img).toBeVisible();
  expect(await img.evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0)).toBe(true);
  await expect(card.locator('.card-label')).toHaveCount(3);
  await expect(card.locator('.card-label.asked')).toHaveText('B');
  // Centered, at most 640px wide.
  const box = (await card.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(641);
});

test('every size: rate a card and finish via End session; reduced motion turns the flip animation off', async ({ browser }, info) => {
  const context = await browser.newContext({ ...info.project.use, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await startDeck(page, 'Cram');
  await page.getByRole('button', { name: 'Show answer' }).click();
  const anim = await page.getByTestId('flashcard').evaluate((el) => getComputedStyle(el).animationName);
  expect(anim).toBe('none');
  await page.getByRole('button', { name: /^Got it/ }).click();
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByTestId('card-summary')).toBeVisible();
  await expect(page.getByText('Practice session: the schedule was not changed.')).toBeVisible();
  await context.close();
});

test('wrong drill answer → its related cards → session → summary → drill these topics', async ({ page }) => {
  const sample = JSON.parse(readFileSync(SAMPLE_PACK, 'utf8')) as { questions: { id: string; stem: string; options: { key: string; correct: boolean }[] }[] };
  await importPack(page, '/');
  await page.goto('/#/drill?topics=alpha-glowroot-anatomy');
  await page.getByRole('button', { name: /Start drill/ }).click();
  const stem = (await page.getByTestId('stem').textContent()) ?? '';
  const q = sample.questions.find((x) => stem.includes(x.stem))!;
  await page.keyboard.press(q.options.find((o) => !o.correct)!.key.toLowerCase());
  const link = page.getByTestId('related-cards');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByText(/linked to a question/)).toBeVisible();
  await page.getByTestId('start-cards').click();
  // Rate every card shown until the summary.
  for (let i = 0; i < 6 && !(await page.getByTestId('card-summary').isVisible()); i++) {
    await page.getByRole('button', { name: 'Show answer' }).click();
    await page.getByRole('button', { name: /^Got it/ }).click();
  }
  await expect(page.getByTestId('card-summary')).toBeVisible();
  await page.getByRole('link', { name: /^Drill/ }).click();
  await expect(page).toHaveURL(/#\/drill\?topics=alpha-glowroot-anatomy/);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up a drill' })).toBeVisible();
});

test('Home: the cards tile starts a session', async ({ page }) => {
  await importPack(page, '/');
  await page.goto('/#/');
  const tile = page.getByTestId('cards-tile');
  await expect(tile).toContainText('+10 new');
  await tile.getByRole('link', { name: 'Start cards' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Flashcards' })).toBeVisible();
});
