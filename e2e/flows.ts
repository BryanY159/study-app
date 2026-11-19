import { expect, type Page } from '@playwright/test';
import path from 'node:path';

/** The synthetic sample pack. The app ships with no pack, so every flow imports this one first. */
export const SAMPLE_PACK = path.resolve('test/fixtures/sample-pack.json');

/** Import a pack file through History & data → Import pack…, the same way a user does. */
export async function importPack(page: Page, url: string, file = SAMPLE_PACK, questions = 13) {
  await page.goto(url + '#/data');
  await page.getByTestId('pack-input').setInputFiles(file);
  await expect(page.getByTestId('data-message')).toContainText(`${questions} questions`);
}

/** Open every branch of the topic tree (drill and card setup start collapsed). */
export async function expandTree(page: Page) {
  const link = page.getByTestId('tree-expand-all');
  if ((await link.textContent())?.includes('Expand all')) await link.click();
}

/** FR-2 happy path: pick one topic, answer 3 questions by keyboard, end, see it on the dashboard. */
export async function drillFlow(page: Page, url: string) {
  await importPack(page, url);
  await page.goto(url + '#/drill');
  await expandTree(page);
  // Everything starts selected: clear each module, then pick one topic.
  for (const name of ['Glowroots', 'Skyvines', 'Ember moss']) {
    const box = page.getByRole('checkbox', { name, exact: true });
    if (await box.isChecked()) await box.click();
  }
  await page.getByRole('checkbox', { name: /^Glowroot anatomy/ }).check();
  await page.getByRole('button', { name: '10', exact: true }).click();
  await page.getByRole('button', { name: /Start drill/ }).click();

  for (let i = 1; i <= 3; i++) {
    await expect(page.getByTestId('drill-position')).toContainText(`Question ${i} of`);
    await expect(page.getByTestId('stem')).toBeVisible();
    await page.keyboard.press('a');
    await expect(page.getByTestId('feedback')).toBeVisible();
    await expect(page.getByRole('status')).toHaveText(/Correct|Incorrect/);
    await expect(page.getByText('Sources', { exact: true })).toBeVisible();
    await page.keyboard.press('Enter');
  }
  await page.getByRole('button', { name: /End drill/ }).click();

  const row = page.getByTestId('session-row').first();
  await expect(row).toContainText('Drill · 1 topic');
  await expect(row).toContainText('/3');
  await expect(page.getByTestId('topic-row').filter({ hasText: 'Glowroot anatomy' })).toHaveCount(1);
}

/** Wait until a value saved by the app is in IndexedDB (saves land a few ms after the action). */
export async function waitForSaved(page: Page, store: 'docs' | 'meta', key: string, check: string) {
  await page.waitForFunction(
    async ([store, key, check]) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const q = indexedDB.open('studyapp-data');
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
      const value = await new Promise<unknown>((resolve) => {
        const g = db.transaction(store).objectStore(store).get(key);
        g.onsuccess = () => resolve(g.result);
        g.onerror = () => resolve(undefined);
      });
      db.close();
      return new Function('v', `return (${check})`)(value) === true;
    },
    [store, key, check] as const,
  );
}
