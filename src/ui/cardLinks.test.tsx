import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { assembleMock } from '../engine/mock';
import { indexPack } from '../engine/packIndex';
import { overallStats, topicStats } from '../engine/progress';
import { mulberry32 } from '../engine/rng';
import { parsePack } from '../pack/checks';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { cardKey, emptyCards, type Attempt } from '../storage/docs';
import { App } from './App';
import { minutesFor } from './components/CardsTile';

const parsed = parsePack(structuredClone(fixture));
if (!parsed.ok) throw new Error('fixture');
const pack: Pack = parsed.pack;
const noCards: Pack = { ...pack, flashcards: undefined };

describe('flashcards never touch question scoring (FR-14)', () => {
  const attempts: Attempt[] = pack.questions.slice(0, 6).map((q, i) => ({ id: `a${i}`, questionId: q.id, packId: pack.packId, sessionId: 's', mode: 'drill', chosen: ['A'], correct: i % 2 === 0, at: `2026-11-1${i}T00:00:00Z`, ms: 1 }));
  it('topic and overall stats are identical with and without cards', () => {
    expect(topicStats(indexPack(pack), attempts)).toEqual(topicStats(indexPack(noCards), attempts));
    expect(overallStats(indexPack(pack), attempts)).toEqual(overallStats(indexPack(noCards), attempts));
  });
  it('mock assembly picks the same questions with and without cards', () => {
    expect(assembleMock(indexPack(pack), pack.examBlueprint, mulberry32(42))).toEqual(assembleMock(indexPack(noCards), noCards.examBlueprint, mulberry32(42)));
  });
});

function renderAt(hash: string, store = new MemoryDataStore(), p: Pack = pack) {
  window.location.hash = hash;
  render(
    <AppProvider store={store} bundledPacks={[p]} loadImported={async () => []} saveImported={async () => {}} now={() => new Date('2026-11-17T10:00:00')}>
      <App />
    </AppProvider>,
  );
  return store;
}

describe('Home: cards tile and topic card progress', () => {
  afterEach(cleanup);

  it('shows cards due today (+ new), a time estimate and Start; topic rows show learned / total', async () => {
    const store = new MemoryDataStore();
    await store.write('cards', {
      ...emptyCards(),
      states: {
        [cardKey('sample-orrin', 'c-alpha-0001')]: { box: 2, dueDate: '2026-11-16', lastReviewedAt: 'x', updatedAt: 'x' },
        [cardKey('sample-orrin', 'c-alpha-0002')]: { box: 5, dueDate: '2026-11-30', lastReviewedAt: 'x', updatedAt: 'x' },
      },
    });
    // One answer in the anatomy topic so it shows in the topic list.
    await store.write('progress', { schemaVersion: 1, updatedAt: '', restoredAt: '', attempts: [{ id: 'a1', questionId: 'q-alpha-0001', packId: 'sample-orrin', sessionId: 's', mode: 'drill', chosen: ['B'], correct: false, at: '2026-11-17T09:00:00Z', ms: 1 }], sessions: [], activeMock: null, settings: { hideFlagged: false, activePackId: null, newCardsPerDay: 20 } });
    renderAt('#/', store);
    const tile = await screen.findByTestId('cards-tile');
    expect(within(tile).getByTestId('cards-due')).toHaveTextContent('1');
    expect(tile).toHaveTextContent('+8 new');
    expect(tile).toHaveTextContent(`About ${minutesFor(9)} minutes`);
    expect(within(tile).getByRole('link', { name: 'Start cards' })).toHaveAttribute('href', '#/cards');
    expect(screen.getByTestId('topic-cards')).toHaveTextContent('Cards 1/3 learned');
  });

  it('no tile for a pack without cards', async () => {
    renderAt('#/', new MemoryDataStore(), noCards);
    await screen.findByText('Welcome back');
    expect(screen.queryByTestId('cards-tile')).toBeNull();
  });
});

describe('drill: cards for a wrong answer', () => {
  afterEach(cleanup);

  /** Answer the question on screen right or wrong, using the pack's answer key. */
  function answer(correct: boolean) {
    const stem = screen.getByTestId('stem').textContent ?? '';
    const q = pack.questions.find((x) => stem.includes(x.stem))!;
    const key = q.options.find((o) => o.correct === correct)!.key;
    fireEvent.keyDown(window, { key: key.toLowerCase() });
    return q;
  }

  it('a wrong answer offers its related cards (or the topic cards); a right answer offers none', async () => {
    renderAt('#/drill?topics=alpha-glowroot-anatomy');
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    await screen.findByTestId('stem');
    answer(true);
    await screen.findByTestId('feedback');
    expect(screen.queryByTestId('related-cards')).toBeNull();
    fireEvent.keyDown(window, { key: 'Enter' });
    await screen.findByText(/Question 2 of/);
    const q = answer(false);
    await screen.findByTestId('feedback');
    const link = screen.getByTestId('related-cards');
    const related = pack.flashcards!.filter((c) => c.relatedQuestionIds.includes(q.id));
    if (related.length) {
      expect(link).toHaveTextContent(`Review the ${related.length} related card`);
      expect(link.getAttribute('href')).toBe(`#/cards?ids=${related.map((c) => c.id).join(',')}`);
    } else {
      expect(link).toHaveTextContent('Review cards for this topic');
    }
  });
});
