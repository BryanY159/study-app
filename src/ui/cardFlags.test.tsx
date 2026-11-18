import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import fixture from '../../test/fixtures/sample-pack.json';
import { flagState, flagsToJson, flagsToMarkdown, seedPreflags } from '../engine/flags';
import { parsePack } from '../pack/checks';
import type { Pack } from '../pack/schema';
import { AppProvider } from '../state/AppProvider';
import { MemoryDataStore } from '../storage/DataStore';
import { emptyFlags, type Flag } from '../storage/docs';
import { App } from './App';

const parsed = parsePack(structuredClone(fixture));
if (!parsed.ok) throw new Error('fixture');
const pack: Pack = parsed.pack;

const cardFlag: Flag = {
  id: 'flag-card-1',
  packId: 'sample-orrin',
  packVersion: 1,
  itemType: 'card',
  questionId: 'c-beta-0002',
  reason: 'unclear',
  comment: 'The blank could be two words.',
  mode: 'review',
  source: 'user',
  createdAt: '2026-11-17T10:00:00.000Z',
  updatedAt: '2026-11-17T10:00:00.000Z',
};

describe('card flags in the engine', () => {
  it('unconfirmed cards get a pre-flag like unconfirmed questions, once', () => {
    const seeded = seedPreflags([], [pack])!;
    expect(seeded.filter((f) => f.itemType === 'card')).toEqual([expect.objectContaining({ id: 'preflag-sample-orrin-c-gamma-0003', questionId: 'c-gamma-0003', source: 'preflag' })]);
    expect(seeded.filter((f) => f.itemType === 'question')).toHaveLength(1);
    expect(seedPreflags(seeded, [pack])).toBeNull();
  });

  it('a card flag is open while the card exists, missing when it is gone', () => {
    expect(flagState(cardFlag, [pack])).toBe('open');
    expect(flagState({ ...cardFlag, questionId: 'c-beta-0099' }, [pack])).toBe('missing');
  });

  it('exports include card flags with itemType, itemId and a snapshot of the card', () => {
    const json = JSON.parse(flagsToJson([cardFlag], [pack], new Date('2026-11-17T12:00:00Z')));
    expect(json.flags[0]).toMatchObject({ itemType: 'card', itemId: 'c-beta-0002', state: 'open', card: { id: 'c-beta-0002', type: 'cloze' } });
    const md = flagsToMarkdown([cardFlag], [pack], new Date('2026-11-17T12:00:00Z'));
    expect(md).toContain('# Flagged questions (0) and cards (1)');
    expect(md).toContain('## Card c-beta-0002 — ');
    expect(md).toContain('**Card (cloze):** A skyvine grown ____ still releases its frost scent.');
    expect(md).toContain('Comment: The blank could be two words.');
  });
});

describe('Flags screen with card flags', () => {
  afterEach(cleanup);

  it('lists card flags with the card front, filters questions / cards, and opens the card', async () => {
    const store = new MemoryDataStore();
    await store.write('flags', { ...emptyFlags(), flags: [cardFlag] });
    window.location.hash = '#/flags';
    render(
      <AppProvider store={store} bundledPacks={[pack]} loadImported={async () => []} saveImported={async () => {}}>
        <App />
      </AppProvider>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Flagged questions' });
    // The user's card flag, plus the two seeded pre-flags (one question, one card).
    await waitFor(() => expect(screen.getAllByTestId('flag-item')).toHaveLength(3)); // pre-flags are seeded just after load
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    const cards = screen.getAllByTestId('flag-item');
    expect(cards).toHaveLength(2);
    expect(cards.every((el) => el.getAttribute('data-kind') === 'card')).toBe(true);
    const mine = cards.find((el) => el.textContent?.includes('The blank could be two words.'))!;
    expect(mine).toHaveTextContent('A skyvine grown ____ still releases its frost scent.');
    fireEvent.click(within(mine).getByRole('button', { name: 'Open card' }));
    expect(within(mine).getByTestId('card-back')).toHaveTextContent('alone in a sealed jar');
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    expect(screen.getAllByTestId('flag-item')).toHaveLength(1);
  });
});
