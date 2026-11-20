import { expect, test } from '@playwright/test';
import { drillFlow } from './flows';

// Home at each viewport. Screenshots are kept as test artifacts for review (not pixel-compared).

test('Home layout per viewport', async ({ page }, info) => {
  await drillFlow(page, '/'); // imports the pack and records one drill session
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  await info.attach(`home-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  const columns = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const project = info.project.name;
  if (project === 'phone') {
    expect(await columns('.grid-3')).toBe(2); // Drill · Mock two-up, the third full width
    expect(await columns('.grid-main')).toBe(1);
    // One column, in order: reminder → quick actions → topics → the rest.
    const top = async (sel: string) => (await page.locator(sel).first().boundingBox())!.y;
    const reminder = await top('[data-testid="backup-reminder"]');
    const actions = await top('.grid-3');
    const topics = await top('[data-testid="topic-row"]');
    expect(reminder).toBeLessThan(actions);
    expect(actions).toBeLessThan(topics);
    // Recent sessions are folded away until asked for.
    const recent = page.getByTestId('recent-sessions');
    await expect(recent.getByTestId('session-row').first()).toBeHidden();
    await recent.getByText('Show recent sessions').click();
    await expect(recent.getByTestId('session-row').first()).toBeVisible();
  } else if (project === 'tablet') {
    expect(await columns('.grid-3')).toBe(2);
    expect(await columns('.grid-main')).toBe(2);
    await expect(page.getByTestId('recent-sessions').getByTestId('session-row').first()).toBeVisible();
  } else {
    expect(await columns('.grid-3')).toBe(3);
    expect(await columns('.grid-main')).toBe(2);
    await expect(page.getByTestId('recent-sessions').getByTestId('session-row').first()).toBeVisible();
  }
});

test('FR-17: "Drill weakest" is in the topics header everywhere, and on phone also a chip visible without scrolling', async ({ page }, info) => {
  await drillFlow(page, '/');
  await page.goto('/#/');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  const section = page.getByTestId('topics');
  const action = section.getByTestId('drill-weakest');
  await expect(action).toBeVisible();
  expect((await action.boundingBox())!.y).toBeLessThan((await section.getByTestId('topic-row').first().boundingBox())!.y);
  if (info.project.name === 'phone') {
    const chip = page.getByTestId('drill-weakest-chip');
    await expect(chip).toBeInViewport();
    await chip.tap();
    await expect(page).toHaveURL(/#\/drill\?topics=/);
  } else {
    await expect(page.getByTestId('drill-weakest-chip')).toHaveCount(0);
  }
});

test('phone: the missed / flagged links stay reachable on Home', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone layout only');
  await drillFlow(page, '/');
  await page.goto('/#/');
  await expect(page.getByRole('link', { name: /flagged$/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /missed$/ })).toBeVisible();
});

test('Home: the weakest topic shows its path, and the progress tree opens level by level and remembers it', async ({ page }, info) => {
  await drillFlow(page, '/'); // answers 3 questions from Glowroot anatomy (First season › Glowroots)
  await page.goto('/#/');
  await expect(page.getByTestId('topic-row').first()).toContainText('First season › Glowroots · 3 answered');

  const tree = page.getByTestId('topic-tree');
  const group = tree.getByRole('button', { name: /^First season/ });
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await expect(group).toBeVisible();
  await expect(tree.getByTestId('tree-group').first()).toContainText(/\d+% · 3 of 12 seen/);
  await expect(tree.getByRole('button', { name: /^Glowroots/ })).toHaveCount(0);

  await group.click();
  await tree.getByRole('button', { name: /^Glowroots/ }).click();
  await expect(tree.getByTestId('tree-topic').filter({ hasText: 'Glowroot anatomy' })).toContainText(/3 of \d+ seen/);
  await info.attach(`home-tree-${info.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });

  await page.reload();
  await expect(tree.getByTestId('tree-topic').filter({ hasText: 'Glowroot anatomy' })).toBeVisible();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
  // Rows and toggles are at least 44px tall.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.ttree button, .ttree .tt-label')].filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44).length,
  );
  expect(small).toBe(0);
});
