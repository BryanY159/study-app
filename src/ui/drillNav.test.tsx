import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makePack } from '../../test/makePack';
import type { Pack } from '../pack/schema';
import { AppProvider, type DrillRun } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import type { FlagsDoc, ProgressDoc } from '../storage/docs';
import { App } from './App';
import { arrowsActive, backToCurrent, chipStates, nextWhileViewing, prev, shownIndex, viewAt } from './drillNav';

const run = (index: number, answered: Record<string, string[]>, viewing: number | null = null): DrillRun => ({
  sessionId: 's',
  questionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
  index,
  answers: answered,
  viewing,
});
const correctIfA = (_id: string, c: readonly string[]) => c[0] === 'A';

describe('drill navigation rules (FR-16)', () => {
  const d = run(2, { q1: ['A'], q2: ['B'] }); // two answered, live question 3 unanswered

  it('chips: correct / incorrect / current / not yet', () => {
    expect(chipStates(d, correctIfA)).toEqual(['correct', 'incorrect', 'current', 'not-yet', 'not-yet']);
    expect(chipStates(viewAt(d, 0), correctIfA)).toEqual(['current', 'incorrect', 'not-yet', 'not-yet', 'not-yet']);
  });

  it('only answered earlier questions can be opened; later ones are ignored; the live one returns to it', () => {
    expect(viewAt(d, 1).viewing).toBe(1);
    expect(viewAt(d, 3)).toBe(d);
    expect(viewAt(d, -1)).toBe(d);
    expect(viewAt(viewAt(d, 0), 2).viewing).toBeNull();
    expect(backToCurrent(viewAt(d, 0)).viewing).toBeNull();
  });

  it('Previous steps back from whatever is on screen; Next while viewing steps forward to the live one', () => {
    const a = prev(d);
    expect(shownIndex(a)).toBe(1);
    const b = prev(a);
    expect(shownIndex(b)).toBe(0);
    expect(prev(b)).toBe(b); // can't go before the first
    expect(shownIndex(nextWhileViewing(b))).toBe(1);
    expect(nextWhileViewing(nextWhileViewing(b)).viewing).toBeNull(); // back on the live question
    expect(nextWhileViewing(d)).toBe(d);
  });

  it('←/→ only once the live question has feedback, or while viewing', () => {
    expect(arrowsActive(d)).toBe(false); // live question unanswered: A–D answer it
    expect(arrowsActive(viewAt(d, 0))).toBe(true);
    expect(arrowsActive(run(2, { q1: ['A'], q2: ['B'], q3: ['C'] }))).toBe(true);
  });
});

describe('reviewing earlier questions in a drill', () => {
  afterEach(cleanup);

  it('answer 3, go back to 1 (read-only, same feedback), flag it, back to current; still 3 answers', async () => {
    const store = new MemoryDataStore();
    window.location.hash = '#/drill';
    render(
      <AppProvider store={store} bundledPacks={[makePack({ a: 5 }) as Pack]} loadImported={async () => []} saveImported={async () => {}}>
        <App />
      </AppProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Start drill/ }));
    for (let i = 0; i < 3; i++) {
      await screen.findByTestId('drill-position');
      fireEvent.keyDown(window, { key: 'a' });
      await screen.findByTestId('feedback');
      if (i < 2) fireEvent.keyDown(window, { key: 'Enter' });
    }
    const firstStem = () => screen.getByTestId('stem').textContent;
    const strip = screen.getByTestId('question-strip');
    expect(within(strip).getByRole('button', { name: /Question 4, not answered yet/ })).toBeDisabled();

    // Back to question 1 by its chip.
    const live = firstStem();
    fireEvent.click(within(strip).getByRole('button', { name: /^Question 1,/ }));
    expect(await screen.findByTestId('reviewing')).toHaveTextContent('question 1');
    expect(firstStem()).not.toBe(live);
    expect(screen.getByTestId('feedback')).toBeInTheDocument(); // read-only feedback, no answer buttons
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.keyDown(window, { key: 'b' }); // ignored: can't answer again

    // Flagging still works while reviewing.
    fireEvent.click(screen.getByRole('button', { name: 'Flag this question' }));
    fireEvent.click(await screen.findByRole('button', { name: /Save flag/ }));
    await waitFor(async () => expect(((await store.read('flags')) as FlagsDoc | null)?.flags.length).toBe(1));

    // ← and → move through answered questions; → from 3 is the live one.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('reviewing')).toHaveTextContent('question 2');
    fireEvent.click(screen.getByRole('button', { name: 'Back to current question' }));
    await waitFor(() => expect(screen.queryByTestId('reviewing')).toBeNull());
    expect(firstStem()).toBe(live);

    // Nothing was answered twice.
    await waitFor(async () => expect(((await store.read('progress')) as ProgressDoc).attempts).toHaveLength(3));
    expect(screen.getByTestId('drill-position')).toHaveTextContent('Question 3 of');
  });
});
