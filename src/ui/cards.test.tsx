import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { parsePack } from '../pack/checks';
import type { Pack } from '../pack/schema';
import { AppProvider, useApp } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { cardKey, emptyCards, type CardsDoc, type FlagsDoc } from '../storage/docs';
import { App } from './App';
import { swipeRating } from './swipe';

const parsed = parsePack(structuredClone(fixture));
if (!parsed.ok) throw new Error('fixture');
const pack: Pack = parsed.pack;
const NOW = new Date('2026-11-17T10:00:00');

describe('swipe recognizer', () => {
  it('left = Again, right = Got it, only after flipping and past the threshold', () => {
    expect(swipeRating(-120, 5, true)).toBe('again');
    expect(swipeRating(120, -5, true)).toBe('got-it');
    expect(swipeRating(120, 0, false)).toBeNull(); // not flipped yet
    expect(swipeRating(60, 0, true)).toBeNull(); // too short
    expect(swipeRating(100, 90, true)).toBeNull(); // mostly vertical (a scroll)
  });
});

function renderAt(hash: string, store = new MemoryDataStore()) {
  window.location.hash = hash;
  let api: ReturnType<typeof useApp> | null = null;
  const Spy = () => {
    api = useApp();
    return null;
  };
  render(
    <AppProvider store={store} bundledPacks={[pack]} loadImported={async () => []} saveImported={async () => {}} now={() => NOW}>
      <App />
      <Spy />
    </AppProvider>,
  );
  return { store, api: () => api! };
}

const cardsOfStore = async (s: MemoryDataStore) => ((await s.read('cards')) as CardsDoc | null) ?? emptyCards();

describe('deck setup', () => {
  afterEach(cleanup);

  it('shows due / new / learned per topic; the mode changes the start count; Cram practises everything', async () => {
    const store = new MemoryDataStore();
    // One card due today (box 2), one learned and not due (box 4), the rest new.
    await store.write('cards', {
      ...emptyCards(),
      states: {
        [cardKey('sample-orrin', 'c-alpha-0001')]: { box: 2, dueDate: '2026-11-17', lastReviewedAt: 'x', updatedAt: 'x' },
        [cardKey('sample-orrin', 'c-alpha-0002')]: { box: 4, dueDate: '2026-11-24', lastReviewedAt: 'x', updatedAt: 'x' },
      },
    });
    renderAt('#/cards', store);
    await screen.findByRole('heading', { level: 1, name: 'Flashcards' });
    fireEvent.click(screen.getByTestId('tree-expand-all'));
    const anatomy = screen.getAllByTestId('tree-topic').find((el) => el.textContent?.includes('Glowroot anatomy'))!;
    expect(anatomy.textContent).toMatch(/1 due · 1 new · 1\/3 learned/);
    expect(screen.getByTestId('start-cards')).toHaveTextContent('Start · 1 due + 8 new');
    fireEvent.click(screen.getByRole('radio', { name: /Due only/ }));
    expect(screen.getByTestId('start-cards')).toHaveTextContent('Start · 1 due');
    fireEvent.click(screen.getByRole('radio', { name: /Cram/ }));
    expect(screen.getByTestId('start-cards')).toHaveTextContent('Start · 10 cards (practice)');
  });

  it('the card-type filter narrows the selection; nothing selected explains why Start is off', async () => {
    renderAt('#/cards');
    await screen.findByTestId('start-cards');
    for (const t of ['Term', 'Concept', 'Fill in the blank']) fireEvent.click(screen.getByRole('button', { name: t }));
    expect(screen.getByTestId('start-cards')).toHaveTextContent('Start · 0 due + 1 new'); // the diagram card
    fireEvent.click(screen.getByRole('button', { name: 'Diagram' }));
    expect(screen.getByTestId('start-cards')).toBeDisabled();
    expect(screen.getByTestId('cards-empty-reason')).toHaveTextContent('No cards in this selection.');
  });

  it('the daily new-card limit caps new cards, counting cards first rated today', async () => {
    const store = new MemoryDataStore();
    await store.write('progress', { schemaVersion: 1, updatedAt: '', restoredAt: '', attempts: [], sessions: [], activeMock: null, settings: { hideFlagged: false, activePackId: null, newCardsPerDay: 3 } });
    await store.write('cards', { ...emptyCards(), reviews: [{ id: 'r1', cardKey: cardKey('sample-orrin', 'c-beta-0001'), rating: 'got-it', at: NOW.toISOString(), device: '', cram: false }], states: { [cardKey('sample-orrin', 'c-beta-0001')]: { box: 2, dueDate: '2026-11-18', lastReviewedAt: 'x', updatedAt: 'x' } } });
    renderAt('#/cards', store);
    expect(await screen.findByTestId('start-cards')).toHaveTextContent('Start · 0 due + 2 new');
    expect(screen.getByText(/New cards today: 2 of 3 left/)).toBeInTheDocument();
  });
});

describe('card session', () => {
  afterEach(cleanup);

  async function start(mode: 'Due + new' | 'Cram' = 'Due + new') {
    const r = renderAt('#/cards');
    await screen.findByTestId('start-cards');
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(mode.replace('+', '\\+')) }));
    fireEvent.click(screen.getByTestId('start-cards'));
    await screen.findByTestId('flashcard');
    return r;
  }

  it('flip by key, rate by key and button; each rating is saved with the new box', async () => {
    const { store } = await start();
    expect(screen.getByTestId('card-front')).toBeInTheDocument();
    expect(screen.getByTestId('card-live').textContent).toBe('');
    fireEvent.keyDown(window, { key: '2' }); // ignored before flipping
    expect(screen.getByTestId('card-position')).toHaveTextContent('Card 1 of 10');
    fireEvent.keyDown(window, { key: ' ' });
    expect(await screen.findByTestId('card-back')).toBeInTheDocument();
    expect(screen.getByTestId('card-live').textContent).toMatch(/^Answer: /); // announced to screen readers
    expect(screen.getByRole('button', { name: /Got its*box 2 · tomorrow/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agains*box 1 · today/ })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: '2' });
    await screen.findByText(/Card 2 of 10/);
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Got it/ }));
    await waitFor(async () => expect((await cardsOfStore(store)).reviews).toHaveLength(2));
    const states = Object.values((await cardsOfStore(store)).states);
    expect(states.map((s) => [s.box, s.dueDate])).toEqual([
      [2, '2026-11-18'],
      [2, '2026-11-18'],
    ]);
  });

  it('Again brings the card back after 3 other cards', async () => {
    await start();
    const front = () => screen.getByTestId('card-front').querySelector('.card-front-text')!.textContent;
    const first = front();
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: '1' }); // Again
    expect(await screen.findByText(/Card 2 of 11/)).toBeInTheDocument(); // re-queued: one more card
    const seen: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      seen.push(front());
      fireEvent.keyDown(window, { key: ' ' });
      fireEvent.keyDown(window, { key: '2' });
    }
    expect(seen).not.toContain(first);
    expect(front()).toBe(first); // fifth card shown = the one rated Again
  });

  it('Undo restores the card state and removes the review (until the next rating)', async () => {
    const { store } = await start();
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: '2' });
    await waitFor(async () => expect((await cardsOfStore(store)).reviews).toHaveLength(1));
    fireEvent.click(screen.getByTestId('undo'));
    expect(await screen.findByText(/Card 1 of 10/)).toBeInTheDocument();
    expect(screen.getByTestId('card-back')).toBeInTheDocument(); // back on the flipped card
    await waitFor(async () => {
      const c = await cardsOfStore(store);
      expect(c.reviews).toEqual([]);
      expect(c.undone).toHaveLength(1);
      expect(Object.values(c.states).every((s) => s.fresh)).toBe(true); // it was new: new again
    });
    expect(screen.queryByTestId('undo')).toBeNull();
  });

  it('Cram never changes the schedule', async () => {
    const { store } = await start('Cram');
    fireEvent.keyDown(window, { key: ' ' });
    expect(screen.getAllByText('practice only')).toHaveLength(2);
    fireEvent.keyDown(window, { key: '2' });
    await waitFor(async () => expect((await cardsOfStore(store)).reviews).toEqual([expect.objectContaining({ cram: true })]));
    expect((await cardsOfStore(store)).states).toEqual({});
  });

  it('flagging a card saves a card flag', async () => {
    const { store } = await start();
    fireEvent.click(screen.getByRole('button', { name: 'Flag this card' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading')).toHaveTextContent('Flag this card');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save flag' }));
    await waitFor(async () => {
      const f = (await store.read('flags')) as FlagsDoc;
      expect(f.flags.filter((x) => x.source === 'user')).toEqual([expect.objectContaining({ itemType: 'card', questionId: expect.stringMatching(/^c-/), mode: 'review' })]);
    });
  });

  it('the summary counts reviewed, first-try Got it and box 1, and offers to drill those topics', async () => {
    const { api } = await start();
    act(() => api().setCardRun({ ...api().cardRun!, queue: api().cardRun!.queue.slice(0, 2) }));
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: '2' }); // Got it
    await screen.findByText(/Card 2 of 2/);
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: '1' }); // Again → comes back as card 3
    await screen.findByText(/Card 3 of 3/);
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: '2' });
    const summary = await screen.findByTestId('card-summary');
    expect(within(summary).getByTestId('summary-reviewed')).toHaveTextContent('2');
    expect(within(summary).getByTestId('summary-first-try')).toHaveTextContent('50%');
    expect(within(summary).getByTestId('summary-next')).toHaveTextContent('Next due: 2 cards tomorrow');
    expect(within(summary).getByRole('link', { name: /^Drill/ }).getAttribute('href')).toMatch(/^#\/drill\?topics=/);
  });
});
